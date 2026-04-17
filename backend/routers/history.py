from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List
from datetime import date
import calendar

from models.database import get_db, Account, Transaction
from models.auth import User
from utils.auth import get_current_user

router = APIRouter(prefix="/history", tags=["history"])


def _end_of_month(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def _month_range(months_back: int):
    """Return list of (year, month) tuples from oldest to current."""
    today = date.today()
    result = []
    for i in range(months_back - 1, -1, -1):
        m = today.month - i
        y = today.year
        while m <= 0:
            m += 12
            y -= 1
        result.append((y, m))
    return result


@router.get("/net-worth")
def net_worth_history(
    months: int = Query(default=12, ge=1, le=36),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns monthly net worth snapshots.
    Strategy: current_account_balances - sum(transactions after month_end) per month.
    """
    # Exclude investment accounts — user treats them as hidden/separate
    accounts = db.query(Account).filter(
        Account.user_id == current_user.id,
        Account.type != "investment",
    ).all()
    account_ids = {a.id for a in accounts}
    transactions = db.query(Transaction).filter(
        Transaction.user_id == current_user.id,
        Transaction.account_id.in_(account_ids),
    ).all()

    current_accounts_total = sum(float(a.balance) for a in accounts)

    result = []
    for year, month in _month_range(months):
        end = _end_of_month(year, month)
        future_tx_sum = sum(
            float(t.amount) for t in transactions if t.transaction_date > end
        )
        account_total_at_month = current_accounts_total - future_tx_sum
        result.append({
            "month": f"{year}-{month:02d}",
            "net_worth": round(account_total_at_month, 2),
            "accounts": round(account_total_at_month, 2),
        })
    return result


@router.get("/account/{account_id}")
def account_balance_history(
    account_id: int,
    months: int = Query(default=6, ge=1, le=24),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns monthly balance snapshots for a single account."""
    account = db.query(Account).filter(
        Account.id == account_id, Account.user_id == current_user.id
    ).first()
    if not account:
        return []

    transactions = db.query(Transaction).filter(
        Transaction.account_id == account_id,
        Transaction.user_id == current_user.id,
    ).all()

    current_balance = float(account.balance)
    result = []
    for year, month in _month_range(months):
        end = _end_of_month(year, month)
        future_tx_sum = sum(
            float(t.amount) for t in transactions if t.transaction_date > end
        )
        result.append({
            "month": f"{year}-{month:02d}",
            "balance": round(current_balance - future_tx_sum, 2),
        })
    return result
