from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select, union_all
from sqlalchemy.orm import Session
from typing import Dict, List
from datetime import date
from decimal import Decimal
import calendar

from models.database import get_db, Account, AccountBalanceSnapshot, Asset, Transaction, Transfer
from models.auth import User
from utils.auth import get_current_user
from services.balance_snapshots import balance_movements
from services.net_worth import accounts_total, counts_toward_net_worth, holdings_recorded_by
from services.market_prices import get_quotes
from services.valuation import price_keys, value_assets
from utils.dates import user_today

router = APIRouter(prefix="/history", tags=["history"])

CENTS = Decimal("0.01")


# Money leaves this router as `Decimal`, serialised like every other money
# field in the API (a decimal string), never as a float. The client already
# coerces with `Number()` at its boundary.
class MonthBalance(BaseModel):
    month: str
    balance: Decimal


class NetWorthPoint(BaseModel):
    month: str
    # accounts + holdings: the one net worth every screen shows.
    net_worth: Decimal
    accounts: Decimal
    holdings: Decimal


def _end_of_month(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def _month_range(months_back: int, today: date):
    """Return list of (year, month) tuples from oldest to current.

    `today` is the *user's* calendar day, so the current month is the one
    they are living in rather than the server's UTC month.
    """
    result = []
    for i in range(months_back - 1, -1, -1):
        m = today.month - i
        y = today.year
        while m <= 0:
            m += 12
            y -= 1
        result.append((y, m))
    return result


def _balance_history(current_balance: Decimal, movements, months: int, today: date) -> list[MonthBalance]:
    """Month-end balances, walking back from today's balance through `movements`."""
    result = []
    for year, month in _month_range(months, today):
        end = _end_of_month(year, month)
        later = sum((amount for moved_on, amount in movements if moved_on > end), Decimal("0"))
        result.append(MonthBalance(
            month=f"{year}-{month:02d}",
            balance=(current_balance - later).quantize(CENTS),
        ))
    return result


def _first_record(db: Session, user_id: int) -> date | None:
    """The earliest transaction or transfer: where the user's records begin."""
    earliest = union_all(
        select(func.min(Transaction.transaction_date).label("day")).where(Transaction.user_id == user_id),
        select(func.min(Transfer.transfer_date).label("day")).where(Transfer.user_id == user_id),
    ).subquery()
    day = db.execute(select(func.min(earliest.c.day))).scalar()
    if isinstance(day, str):  # SQLite hands back the text
        day = date.fromisoformat(day[:10])
    return day


@router.get("/net-worth", response_model=List[NetWorthPoint])
def net_worth_history(
    months: int = Query(default=12, ge=1, le=36),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Monthly net worth: account balances plus holdings (see `services.net_worth`).

    Past months read the materialized `account_balance_snapshots` table
    (refreshed nightly by `/cron/refresh-balance-snapshots`) and fall back to
    computing from transactions for any month without a full set of snapshots,
    so the endpoint is correct before the first cron run. Holdings count from
    the day they were acquired, at their recorded value.

    The month in progress is never read from a snapshot. Its snapshot is dated
    the last day of the month and was written at the last refresh, so it
    drifted from the balances on screen as soon as anything posted. It uses
    today's balances and today's holdings valuation instead, which is exactly
    what the screens show as "now".

    Months before the first transaction or transfer are not reported. Walking
    back from today's balances past the first record only repeats the opening
    balance, so the live account's chart drew a flat line back to December
    2024 from records that start in March 2026, and quoted "+130% in 24
    months". The screens label a shorter series "Since <month>".
    """
    accounts = db.query(Account).filter(Account.user_id == current_user.id).all()
    assets = db.query(Asset).filter(Asset.user_id == current_user.id).all()
    counted = [a for a in accounts if counts_toward_net_worth(a)]
    if not counted and not assets:
        return []

    account_ids = {a.id for a in counted}
    today = user_today(current_user)
    month_targets = [(_end_of_month(y, m), f"{y}-{m:02d}") for (y, m) in _month_range(months, today)]
    # With no transactions or transfers there is nothing to trim to, and a
    # holdings-only history (or a snapshot one) is still drawn in full.
    first = _first_record(db, current_user.id)
    if first is not None:
        first_month_end = _end_of_month(first.year, first.month)
        month_targets = [(end, label) for end, label in month_targets if end >= first_month_end]
    past_dates = {d for d, _ in month_targets if d < today}

    # Pre-computed month-end snapshots — one row per (account, date).
    snap_by_date: dict[date, dict[int, Decimal]] = {}
    if account_ids and past_dates:
        snapshot_rows = (
            db.query(
                AccountBalanceSnapshot.account_id,
                AccountBalanceSnapshot.snapshot_date,
                AccountBalanceSnapshot.closing_balance,
            )
            .filter(
                AccountBalanceSnapshot.user_id == current_user.id,
                AccountBalanceSnapshot.account_id.in_(account_ids),
                AccountBalanceSnapshot.snapshot_date.in_(past_dates),
            )
            .all()
        )
        for account_id, snap_date, closing in snapshot_rows:
            snap_by_date.setdefault(snap_date, {})[account_id] = Decimal(str(closing))

    current_accounts = accounts_total(counted)
    movements: list[tuple[date, Decimal]] | None = None

    def accounts_at(month_end: date) -> Decimal:
        nonlocal movements
        snap_for_month = snap_by_date.get(month_end, {})
        if account_ids and len(snap_for_month) == len(account_ids):
            return sum(snap_for_month.values(), Decimal("0"))
        if movements is None:
            movements = [m for rows in balance_movements(db, current_user.id, counted).values() for m in rows]
        later = sum((amount for moved_on, amount in movements if moved_on > month_end), Decimal("0"))
        return current_accounts - later

    result = []
    for month_end, label in month_targets:
        if month_end >= today:
            accounts_value = current_accounts
            holdings_value = value_assets(assets, get_quotes(db, price_keys(assets), refresh="never")).total
        else:
            accounts_value = accounts_at(month_end)
            holdings_value = holdings_recorded_by(assets, month_end)
        accounts_value = accounts_value.quantize(CENTS)
        holdings_value = holdings_value.quantize(CENTS)
        result.append(NetWorthPoint(
            month=label,
            net_worth=accounts_value + holdings_value,
            accounts=accounts_value,
            holdings=holdings_value,
        ))
    return result


@router.get("/account/{account_id}", response_model=List[MonthBalance])
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
    movements = balance_movements(db, current_user.id, [account])[account.id]
    return _balance_history(Decimal(str(account.balance)), movements, months, user_today(current_user))


@router.get("/accounts", response_model=Dict[int, List[MonthBalance]])
def account_balances_history(
    months: int = Query(default=6, ge=1, le=24),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return monthly balance snapshots for all of the user's accounts."""
    accounts = db.query(Account).filter(Account.user_id == current_user.id).all()
    if not accounts:
        return {}
    movements = balance_movements(db, current_user.id, accounts)
    today = user_today(current_user)
    return {
        account.id: _balance_history(Decimal(str(account.balance)), movements[account.id], months, today)
        for account in accounts
    }
