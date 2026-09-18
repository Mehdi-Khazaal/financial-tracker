import os
import hmac
from datetime import date, timedelta
from decimal import Decimal
from time import monotonic
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from models.auth import User
from models.database import get_db, RecurringTransaction, Account, Category
from services import merchants, recurring_bills
from services.balance_snapshots import prune_snapshots_older_than, refresh_snapshots_for_user
from services.ledger import LedgerResourceNotFound, LedgerService
from services.recurring_schedule import UnsupportedPeriodError, next_occurrence
from utils.dates import user_today
from utils.logging import get_logger, kv
from utils.push_sender import send_push_to_user

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

# Render's proxy gives a request 30 s. The nightly snapshot refresh stops
# handing out work before that and reports what is left, rather than being
# killed mid-user. Overridable for a bigger plan or a local run.
SNAPSHOT_TIME_BUDGET_SECONDS = float(os.getenv("CRON_TIME_BUDGET_SECONDS", "20"))


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
    3. **Bank-linked bills are never posted.** The bank imports those charges;
       posting them here as well counted them twice. They are reconciled
       against the imported charge instead, for every user with bills, and
       due-soon, missed and price-rise alerts go out once per cycle.
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
        if not account or recurring_bills.is_linked(account):
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

        try:
            tx = LedgerService(db).stage_transaction(
                rec.user_id,
                {
                    "account_id": rec.account_id,
                    "category_id": rec.category_id,
                    "amount": rec.amount,
                    "description": rec.description,
                    "merchant_key": rec.merchant_key or merchants.merchant_key(rec.description) or None,
                    "transaction_date": rec.next_date,
                },
            )
        except LedgerResourceNotFound:
            # Ownership is checked before anything is staged, so nothing for
            # this row is pending and the rows already staged are kept.
            continue
        rec.last_paid_date = rec.next_date
        rec.last_paid_amount = abs(Decimal(str(rec.amount)))
        rec.last_transaction_id = tx.id
        rec.next_date = advanced
        created += 1

    db.commit()

    # Reconcile and alert every user who tracks a bill.
    reconciled = 0
    alerts_sent = 0
    user_ids = [
        row[0] for row in db.query(RecurringTransaction.user_id)
        .filter(RecurringTransaction.is_active == True)  # noqa: E712
        .distinct()
        .all()
    ]
    for user_id in user_ids:
        owner = users.get(user_id) or db.query(User).filter(User.id == user_id).first()
        if owner is None:
            continue
        try:
            today = user_today(owner)
            reconciled += recurring_bills.reconcile_user(db, owner, today=today)
            alerts = recurring_bills.collect_alerts(db, owner, today)
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("cron_recurring_reconcile_failed %s", kv(user_id=user_id))
            continue
        for alert in alerts:
            send_push_to_user(db, owner.id, alert.title, alert.body, url="/recurring", tag=alert.tag)
            alerts_sent += 1

    return {
        "processed": created,
        "skipped_unsupported_period": skipped_unsupported,
        "reconciled": reconciled,
        "alerts": alerts_sent,
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

    users = db.query(User).order_by(User.id).all()
    total_rows = 0
    refreshed = 0
    failed = 0
    deadline = monotonic() + SNAPSHOT_TIME_BUDGET_SECONDS
    for owner in users:
        if monotonic() > deadline:
            # Stop cleanly before the platform's request timeout would. Every
            # user processed so far is committed; the rest are picked up on
            # the next run, and the response says so.
            break
        try:
            # Month-ends in the user's own zone, so their chart's "this month"
            # is the month they are in. `refresh_snapshots_for_user` commits,
            # so one user's failure cannot take another's rows with it.
            total_rows += refresh_snapshots_for_user(
                db, owner.id, months_back=24, include_today=True, today=user_today(owner)
            )
            refreshed += 1
        except Exception:
            db.rollback()
            failed += 1
            logger.exception("cron_snapshot_refresh_failed %s", kv(user_id=owner.id))

    cutoff = date.today().replace(year=date.today().year - 3)
    pruned = prune_snapshots_older_than(db, cutoff)

    return {
        "users": len(users),
        "refreshed": refreshed,
        "failed": failed,
        "remaining": len(users) - refreshed - failed,
        "snapshots_written": total_rows,
        "pruned": pruned,
    }


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
    """Drop short-lived bookkeeping past its TTL. Runs hourly.

    Idempotency records (24 h) and the assistant's pending-action rows (10
    min, or already confirmed) share this job: both are small, both expire on
    their own, and one scheduled call is easier to keep configured than two.
    """
    _require_cron_secret(request)
    from models.database import IdempotencyKey, utc_now
    from routers.assistant.pending import prune_expired_pending_actions
    now = utc_now()
    deleted = db.query(IdempotencyKey).filter(IdempotencyKey.expires_at <= now).delete()
    db.commit()
    pending = prune_expired_pending_actions(db, now=now)
    return {"deleted": deleted, "pending_actions_deleted": pending}


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
