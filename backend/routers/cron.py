import os
import hmac
import calendar
from datetime import date, timedelta
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from models.auth import User
from models.database import get_db, RecurringTransaction, Transaction, Account, Category
from services.balance_snapshots import prune_snapshots_older_than, refresh_snapshots_for_user

router = APIRouter(prefix="/cron", tags=["cron"])


def _require_cron_secret(request: Request) -> None:
    secret = request.headers.get("X-Cron-Secret", "")
    expected = os.getenv("CRON_SECRET")
    if not expected or not hmac.compare_digest(secret.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=403, detail="Forbidden")


def _next_date(current: date, period: str) -> date:
    if period == "weekly":
        return current + timedelta(weeks=1)
    if period == "biweekly":
        return current + timedelta(weeks=2)
    if period == "monthly":
        month = current.month + 1
        year = current.year
        if month > 12:
            month, year = 1, year + 1
        day = min(current.day, calendar.monthrange(year, month)[1])
        return date(year, month, day)
    if period == "quarterly":
        month = current.month + 3
        year = current.year
        while month > 12:
            month -= 12
            year += 1
        day = min(current.day, calendar.monthrange(year, month)[1])
        return date(year, month, day)
    if period == "yearly":
        try:
            return date(current.year + 1, current.month, current.day)
        except ValueError:
            return date(current.year + 1, current.month, 28)
    return current


@router.post("/process-recurring")
def cron_process_recurring(request: Request, db: Session = Depends(get_db)):
    """Process all users' due fixed recurring transactions. Secured by CRON_SECRET."""
    _require_cron_secret(request)

    today = date.today()
    due = (
        db.query(RecurringTransaction)
        .filter(
            RecurringTransaction.is_active == True,
            RecurringTransaction.is_variable == False,
            RecurringTransaction.next_date <= today,
        )
        .all()
    )

    created = 0
    for rec in due:
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
        rec.next_date = _next_date(rec.next_date, rec.period)
        created += 1

    db.commit()
    return {"processed": created, "date": str(today)}


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
