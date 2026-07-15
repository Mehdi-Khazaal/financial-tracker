import os
import hmac
import calendar
from datetime import date, timedelta
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from models.database import get_db, RecurringTransaction, Transaction, Account, Category

router = APIRouter(prefix="/cron", tags=["cron"])


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
    secret = request.headers.get("X-Cron-Secret", "")
    expected = os.getenv("CRON_SECRET")
    if not expected or not hmac.compare_digest(secret.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=403, detail="Forbidden")

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
