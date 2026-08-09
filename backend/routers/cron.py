import os
import hmac
from datetime import date, timedelta
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from models.auth import User
from models.database import get_db, RecurringTransaction, Transaction, Account, Category
from services.balance_snapshots import prune_snapshots_older_than, refresh_snapshots_for_user
from services.recurring_schedule import UnsupportedPeriodError, next_occurrence
from utils.dates import user_today
from utils.logging import get_logger, kv

router = APIRouter(prefix="/cron", tags=["cron"])
logger = get_logger(__name__)


def _require_cron_secret(request: Request) -> None:
    secret = request.headers.get("X-Cron-Secret", "")
    expected = os.getenv("CRON_SECRET")
    if not expected or not hmac.compare_digest(secret.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=403, detail="Forbidden")


# The widest offset any IANA zone is ahead of UTC. Candidate rows are selected
# with this margin and then filtered against each user's own calendar day, so a
# user east of UTC is not skipped for a day.
_MAX_UTC_OFFSET_DAYS = 1


@router.post("/process-recurring")
def cron_process_recurring(request: Request, db: Session = Depends(get_db)):
    """Process all users' due fixed recurring transactions. Secured by CRON_SECRET.

    Two properties this must hold, both learned the hard way:

    1. **Due-ness is per user.** Whether a bill is due today depends on the
       user's calendar day, not the server's. Rows are over-selected by a day
       and then filtered with `user_today`.
    2. **A row that cannot advance is never materialized.** `next_occurrence`
       raises on an unschedulable period rather than returning the date
       unchanged. Skipping such a row is essential: creating its transaction
       and then failing to move `next_date` would leave it permanently due, so
       this nightly job would re-create it and re-apply its amount to the
       balance on *every* run, unattended, forever.
    """
    _require_cron_secret(request)

    utc_today = date.today()
    candidates = (
        db.query(RecurringTransaction)
        .filter(
            RecurringTransaction.is_active == True,
            RecurringTransaction.is_variable == False,
            RecurringTransaction.next_date <= utc_today + timedelta(days=_MAX_UTC_OFFSET_DAYS),
        )
        .all()
    )

    users: dict[int, User] = {}
    created = 0
    skipped_unsupported = 0
    for rec in candidates:
        owner = users.get(rec.user_id)
        if owner is None:
            owner = db.query(User).filter(User.id == rec.user_id).first()
            if owner is None:
                continue
            users[rec.user_id] = owner
        if rec.next_date > user_today(owner):
            continue

        account = db.query(Account).filter(Account.id == rec.account_id, Account.user_id == rec.user_id).first()
        if not account:
            continue
        if rec.category_id is not None:
            category = (
                db.query(Category)
                .filter(Category.id == rec.category_id)
                .filter((Category.user_id == rec.user_id) | (Category.user_id.is_(None)))
                .first()
            )
            if not category:
                continue

        # Resolve the next date before writing anything.
        try:
            advanced = next_occurrence(rec.next_date, rec.period)
        except UnsupportedPeriodError:
            skipped_unsupported += 1
            logger.warning(
                "cron_recurring_skipped_unsupported_period %s",
                kv(recurring_id=rec.id, user_id=rec.user_id, period=rec.period),
            )
            continue

        tx = Transaction(
            user_id=rec.user_id,
            account_id=rec.account_id,
            category_id=rec.category_id,
            amount=rec.amount,
            description=rec.description,
            transaction_date=rec.next_date,
        )
        db.add(tx)
        account.balance = Decimal(str(account.balance)) + Decimal(str(rec.amount))
        rec.next_date = advanced
        created += 1

    db.commit()
    return {
        "processed": created,
        "skipped_unsupported_period": skipped_unsupported,
        "date": str(utc_today),
    }


@router.post("/refresh-balance-snapshots")
def cron_refresh_balance_snapshots(request: Request, db: Session = Depends(get_db)):
    """Materialize month-end balance snapshots for every user.

    Nightly job. Also prunes snapshots older than 3 years so the table stays
    bounded. `/history/net-worth` reads these snapshots so the endpoint stays
    fast even as transaction history grows.
    """
    _require_cron_secret(request)

    user_ids = [uid for (uid,) in db.query(User.id).all()]
    total_rows = 0
    for uid in user_ids:
        total_rows += refresh_snapshots_for_user(db, uid, months_back=24, include_today=True)

    cutoff = date.today().replace(year=date.today().year - 3)
    pruned = prune_snapshots_older_than(db, cutoff)

    return {"users": len(user_ids), "snapshots_written": total_rows, "pruned": pruned}


@router.post("/refresh-merchant-categories")
def cron_refresh_merchant_categories(request: Request, db: Session = Depends(get_db)):
    """Recompute default_category_id for every canonical merchant using the
    majority category across all user transactions. Runs nightly.
    """
    _require_cron_secret(request)
    from services import merchants as _merchants
    updated = _merchants.refresh_canonical_defaults(db)
    return {"canonical_updated": updated}


@router.post("/prune-idempotency-keys")
def cron_prune_idempotency_keys(request: Request, db: Session = Depends(get_db)):
    """Drop idempotency records past their 24h TTL. Runs hourly."""
    _require_cron_secret(request)
    from models.database import IdempotencyKey, utc_now
    now = utc_now()
    deleted = db.query(IdempotencyKey).filter(IdempotencyKey.expires_at <= now).delete()
    db.commit()
    return {"deleted": deleted}


@router.post("/run-jobs")
def cron_run_jobs(request: Request, db: Session = Depends(get_db)):
    """Dispatch up to 25 due background jobs.

    Called every minute by the external scheduler. Keeps hosting serverless-
    friendly — no long-lived worker process needed. Handler registration is
    done at boot via `services.job_handlers`.
    """
    _require_cron_secret(request)
    from services import jobs as jobs_service
    return jobs_service.dispatch(db, limit=25)
