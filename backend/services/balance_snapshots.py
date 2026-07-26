"""Materialized month-end account balance snapshots.

`/history/net-worth` was re-summing every transaction for every request. This
service precomputes month-end closing balances into
`account_balance_snapshots` so history reads become an indexed lookup.

Contract:
- A snapshot's `closing_balance` is the balance the account held at the END of
  `snapshot_date` (i.e. after every transaction dated ≤ snapshot_date has been
  applied).
- Snapshots are stored on the LAST day of each month plus, optionally, "today"
  when running mid-month.
- Idempotent: refresh_snapshots is safe to call any number of times; it
  upserts each (account_id, snapshot_date) pair.
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta
from decimal import Decimal
from typing import Iterable

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from models.database import Account, AccountBalanceSnapshot, Transaction


def _end_of_month(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def _iter_month_ends(from_date: date, to_date: date) -> Iterable[date]:
    """Yield the last-of-month date for every month in [from_date, to_date]."""
    year, month = from_date.year, from_date.month
    while (year, month) <= (to_date.year, to_date.month):
        yield _end_of_month(year, month)
        month += 1
        if month > 12:
            month = 1
            year += 1


def refresh_snapshots_for_user(
    session: Session,
    user_id: int,
    months_back: int = 24,
    include_today: bool = True,
) -> int:
    """Refresh materialized snapshots for one user over the trailing window.

    Uses each account's *current* balance as ground truth and walks
    transactions backward to reconstruct historical balances — same math as
    the old inline endpoint, but done once per snapshot instead of once per
    request. Returns the number of snapshot rows written.
    """
    today = date.today()
    start = _end_of_month(
        today.year if today.month > months_back else today.year - 1,
        ((today.month - months_back - 1) % 12) + 1,
    )

    accounts = (
        session.query(Account)
        .filter(Account.user_id == user_id)
        .all()
    )
    if not accounts:
        return 0

    account_ids = [a.id for a in accounts]
    # Fetch only the columns we need — the raw amount tuples are enough.
    tx_rows = session.execute(
        select(Transaction.account_id, Transaction.transaction_date, Transaction.amount)
        .where(Transaction.user_id == user_id)
        .where(Transaction.account_id.in_(account_ids))
    ).all()

    # Group transactions by account for O(1) lookup while iterating snapshot dates.
    by_account: dict[int, list[tuple[date, Decimal]]] = {aid: [] for aid in account_ids}
    for account_id, tx_date, amount in tx_rows:
        by_account[account_id].append((tx_date, Decimal(str(amount))))

    snapshot_dates = list(_iter_month_ends(start, today))
    if include_today and today not in snapshot_dates:
        snapshot_dates.append(today)

    rows_written = 0
    for account in accounts:
        current_balance = Decimal(str(account.balance))
        transactions = by_account.get(account.id, [])
        for snap_date in snapshot_dates:
            # Balance at end of snap_date = current_balance − sum of transactions dated AFTER snap_date.
            future_sum = sum(
                (amount for tx_date, amount in transactions if tx_date > snap_date),
                Decimal("0"),
            )
            closing = current_balance - future_sum
            _upsert(session, user_id, account.id, snap_date, closing)
            rows_written += 1

    session.commit()
    return rows_written


def _upsert(session: Session, user_id: int, account_id: int, snap_date: date, closing: Decimal) -> None:
    """SQLite + Postgres portable upsert via delete-then-insert on the unique constraint."""
    session.execute(
        delete(AccountBalanceSnapshot)
        .where(AccountBalanceSnapshot.account_id == account_id)
        .where(AccountBalanceSnapshot.snapshot_date == snap_date)
    )
    session.add(
        AccountBalanceSnapshot(
            user_id=user_id,
            account_id=account_id,
            snapshot_date=snap_date,
            closing_balance=closing,
        )
    )


def prune_snapshots_older_than(session: Session, cutoff: date) -> int:
    """Drop snapshots older than `cutoff`. Called by the nightly job."""
    result = session.execute(
        delete(AccountBalanceSnapshot).where(AccountBalanceSnapshot.snapshot_date < cutoff)
    )
    session.commit()
    return result.rowcount or 0
