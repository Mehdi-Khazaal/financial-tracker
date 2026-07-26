from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List
from datetime import date
from decimal import Decimal
import calendar

from models.database import get_db, Account, AccountBalanceSnapshot, Transaction
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


def _balance_history(current_balance: Decimal, transactions, months: int) -> list[dict]:
    result = []
    for year, month in _month_range(months):
        end = _end_of_month(year, month)
        future_tx_sum = sum(
            (Decimal(str(amount)) for amount, transaction_date in transactions if transaction_date > end),
            Decimal("0"),
        )
        result.append({
            "month": f"{year}-{month:02d}",
            "balance": round(float(current_balance - future_tx_sum), 2),
        })
    return result


@router.get("/net-worth")
def net_worth_history(
    months: int = Query(default=12, ge=1, le=36),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Monthly net-worth snapshots.

    Reads from the materialized `account_balance_snapshots` table (refreshed
    nightly by `/cron/refresh-balance-snapshots`) for constant-time O(months)
    performance. Falls back to on-the-fly computation for any month with no
    snapshot yet — so the endpoint stays correct before the first cron run
    and immediately after a big backfill.

    Investment accounts are excluded (user treats them as separate).
    """
    accounts = db.query(Account).filter(
        Account.user_id == current_user.id,
        Account.type != "investment",
    ).all()
    if not accounts:
        return []

    account_ids = {a.id for a in accounts}
    month_targets = [(_end_of_month(y, m), f"{y}-{m:02d}") for (y, m) in _month_range(months)]
    target_dates = {d for d, _ in month_targets}

    # Pre-computed month-end snapshots — one row per (account, date). Use the
    # LAST snapshot on or before each target date to be resilient to accounts
    # created after the earliest snapshot window.
    snapshot_rows = (
        db.query(
            AccountBalanceSnapshot.account_id,
            AccountBalanceSnapshot.snapshot_date,
            AccountBalanceSnapshot.closing_balance,
        )
        .filter(
            AccountBalanceSnapshot.user_id == current_user.id,
            AccountBalanceSnapshot.account_id.in_(account_ids),
            AccountBalanceSnapshot.snapshot_date.in_(target_dates),
        )
        .all()
    )
    snap_by_date: dict[date, dict[int, Decimal]] = {}
    for account_id, snap_date, closing in snapshot_rows:
        snap_by_date.setdefault(snap_date, {})[account_id] = Decimal(str(closing))

    # Fallback for months not yet snapshotted — reuse the historical algorithm.
    needs_fallback = any(target not in snap_by_date or len(snap_by_date[target]) < len(account_ids) for target in target_dates)
    if needs_fallback:
        transactions = db.query(Transaction).filter(
            Transaction.user_id == current_user.id,
            Transaction.account_id.in_(account_ids),
        ).all()
        current_accounts_total = sum((Decimal(str(a.balance)) for a in accounts), Decimal("0"))

    result = []
    for month_end, label in month_targets:
        snap_for_month = snap_by_date.get(month_end, {})
        if len(snap_for_month) == len(account_ids):
            total = sum(snap_for_month.values(), Decimal("0"))
        else:
            # Fall back to on-the-fly compute for this month.
            future_tx_sum = sum(
                (Decimal(str(t.amount)) for t in transactions if t.transaction_date > month_end),
                Decimal("0"),
            )
            total = current_accounts_total - future_tx_sum
        result.append({
            "month": label,
            "net_worth": round(float(total), 2),
            "accounts": round(float(total), 2),
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

    transactions = (
        db.query(Transaction.amount, Transaction.transaction_date)
        .filter(
            Transaction.account_id == account_id,
            Transaction.user_id == current_user.id,
        )
        .all()
    )
    return _balance_history(Decimal(str(account.balance)), transactions, months)


@router.get("/accounts")
def account_balances_history(
    months: int = Query(default=6, ge=1, le=24),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return monthly balance snapshots for all of the user's accounts."""
    accounts = db.query(Account).filter(Account.user_id == current_user.id).all()
    if not accounts:
        return {}

    account_ids = [account.id for account in accounts]
    transaction_rows = (
        db.query(Transaction.account_id, Transaction.amount, Transaction.transaction_date)
        .filter(
            Transaction.user_id == current_user.id,
            Transaction.account_id.in_(account_ids),
        )
        .all()
    )
    transactions_by_account = {account_id: [] for account_id in account_ids}
    for account_id, amount, transaction_date in transaction_rows:
        transactions_by_account[account_id].append((amount, transaction_date))

    return {
        account.id: _balance_history(
            Decimal(str(account.balance)),
            transactions_by_account[account.id],
            months,
        )
        for account in accounts
    }
