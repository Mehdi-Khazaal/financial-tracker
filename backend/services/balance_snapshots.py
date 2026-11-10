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
from typing import Iterable, Optional

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from models.database import Account, AccountBalanceSnapshot, Transaction, Transfer


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


Movement = tuple[date, Decimal]

# How far apart a recorded transfer and the bank's own row for the same move
# can be dated and still be recognised as one movement. Banks post a transfer a
# day or two after it is made, and over a weekend.
TRANSFER_MATCH_DAYS = 5


def balance_movements(session: Session, user_id: int, accounts: Iterable[Account]) -> dict[int, list[Movement]]:
    """Every dated change to each account's balance, keyed by account id.

    A past balance is the current balance minus every movement dated after
    it. This is the single list of what counts as a movement, shared by the
    stored snapshots and the on-the-fly history endpoints so they cannot
    disagree.

    Two sources move a balance:

    * **Transactions** on the account.
    * **Transfers** between the user's own accounts (the `transfers` table).
      These were once left out, so every move recorded through the Transfer
      sheet made both accounts' histories wrong by its amount, for every month
      before it.

    A transfer touching a bank-linked account may also arrive from the bank as
    an ordinary transaction. Counting both would move that account twice, so
    on a linked account the bank's row wins: a transfer leg is counted only
    when no transaction of the same signed amount sits within
    `TRANSFER_MATCH_DAYS` of it. A manual account (cash, a wallet) has no bank
    copy, so its transfer legs always count.
    """
    accounts = list(accounts)
    ids = [a.id for a in accounts]
    by_account: dict[int, list[Movement]] = {aid: [] for aid in ids}
    if not ids:
        return by_account
    rows = session.execute(
        select(Transaction.account_id, Transaction.transaction_date, Transaction.amount)
        .where(Transaction.user_id == user_id)
        .where(Transaction.account_id.in_(ids))
    ).all()
    for account_id, moved_on, amount in rows:
        by_account[account_id].append((moved_on, Decimal(str(amount))))

    linked = {a.id for a in accounts if a.plaid_account_id}
    bank_rows = {aid: list(by_account[aid]) for aid in linked}
    transfers = session.execute(
        select(Transfer.from_account_id, Transfer.to_account_id, Transfer.transfer_date, Transfer.amount)
        .where(Transfer.user_id == user_id)
    ).all()
    for from_id, to_id, moved_on, amount in transfers:
        amount = Decimal(str(amount))
        for account_id, signed in ((from_id, -amount), (to_id, amount)):
            if account_id not in by_account:
                continue
            if account_id in linked and _bank_has_row(bank_rows[account_id], moved_on, signed):
                continue
            by_account[account_id].append((moved_on, signed))
    return by_account


def _bank_has_row(rows: list[Movement], moved_on: date, signed: Decimal) -> bool:
    """Claim the bank row for this transfer leg, if there is one.

    Removes the matched row from `rows` so two equal transfers in the same
    week are matched to two bank rows, not both to the first.
    """
    window = timedelta(days=TRANSFER_MATCH_DAYS)
    for index, (row_date, row_amount) in enumerate(rows):
        if row_amount == signed and abs(row_date - moved_on) <= window:
            del rows[index]
            return True
    return False


def refresh_snapshots_for_user(
    session: Session,
    user_id: int,
    months_back: int = 24,
    include_today: bool = True,
    *,
    today: Optional[date] = None,
) -> int:
    """Refresh materialized snapshots for one user over the trailing window.

    Uses each account's *current* balance as ground truth and walks
    transactions backward to reconstruct historical balances — same math as
    the old inline endpoint, but done once per snapshot instead of once per
    request. Returns the number of snapshot rows written.

    `today` should be the user's own calendar day (`utils.dates.user_today`)
    so the "current month" and the mid-month snapshot line up with what they
    see; callers without a user object fall back to the server's date.
    """
    today = today or date.today()
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

    by_account = balance_movements(session, user_id, accounts)

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
