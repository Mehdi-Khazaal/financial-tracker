"""Tracked bills against the real ledger: matching, status, month totals, alerts.

The duplicate this fixes
────────────────────────
The scheduler used to *create* a transaction for every due fixed bill, on every
account. On a bank-linked account the bank then imported the same charge, so a
declared Netflix subscription was counted twice in spending and applied twice
to a balance Plaid immediately overwrote. A bill on a linked account is now
never posted by the app — `reconcile_user` marks it paid when the matching
imported charge arrives. Manual accounts keep being posted, because nothing
else will ever record those charges.

Matching
────────
An imported transaction pays a bill when it has the same merchant identity
(Plaid entity id, or merchant key), the same direction (money in or out), a
plausible amount, and a date inside the bill's window around `next_date`.
A charge whose name differs ("Landlord" for a bill called "Rent") still matches
when account, category and amount all agree — see `category_twin`. The
window widens with the cycle: three days either side for a weekly charge,
several weeks for a yearly renewal, because posting dates slip.

One month, one figure
─────────────────────
`month_summary` answers "how much will recurring bills cost this month": what
has already been paid in the calendar month, plus every occurrence still due
before it ends. The two parts never overlap — a paid cycle has already moved
`next_date` past itself — so the total is safe to add up.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from models.auth import User
from models.database import Account, RecurringTransaction, Transaction
from services import recurring_groups
from services.recurring_detection import CYCLE_DAYS, category_twin, recurring_keys, transaction_key
from services.recurring_schedule import UnsupportedPeriodError, next_occurrence, occurrences_per_year
from utils.dates import user_today
from utils.logging import get_logger, kv

logger = get_logger(__name__)

# Days a matching charge may land before / after the due date.
MATCH_WINDOW: dict[str, tuple[int, int]] = {
    "weekly": (3, 3),
    "biweekly": (4, 5),
    "monthly": (8, 10),
    "quarterly": (15, 20),
    "yearly": (25, 30),
}
DUE_SOON_DAYS = 7
REMINDER_DAYS = 2
PRICE_ALERT_RECENT_DAYS = 7


def is_linked(account: Optional[Account]) -> bool:
    return bool(account and account.plaid_account_id)


def monthly_equivalent(rec: RecurringTransaction) -> Decimal:
    try:
        per_year = occurrences_per_year(rec.period)
    except UnsupportedPeriodError:
        return Decimal("0")
    return (abs(Decimal(str(rec.amount))) * per_year / 12).quantize(Decimal("0.01"))


def effective_group(rec: RecurringTransaction, category_name: Optional[str] = None) -> str:
    if rec.group_key in recurring_groups.GROUP_KEYS:
        return rec.group_key
    return recurring_groups.classify(
        amount_is_income=Decimal(str(rec.amount)) > 0,
        category_name=category_name,
        merchant_key=rec.merchant_key or " ".join(sorted(recurring_keys(rec))),
        fixed_amount=not rec.is_variable,
    )


def _identity_matches(rec: RecurringTransaction, tx: Transaction, keys: set[str]) -> bool:
    if rec.plaid_merchant_entity_id and tx.plaid_merchant_entity_id:
        if rec.plaid_merchant_entity_id == tx.plaid_merchant_entity_id:
            return True
    elif transaction_key(tx) in keys:
        return True
    return category_twin(rec, tx)


def _amount_plausible(rec: RecurringTransaction, tx: Transaction) -> bool:
    expected = abs(Decimal(str(rec.amount)))
    actual = abs(Decimal(str(tx.amount)))
    if (Decimal(str(rec.amount)) < 0) != (Decimal(str(tx.amount)) < 0):
        return False
    if expected == 0:
        return True
    if rec.is_variable:
        return expected / 4 <= actual <= expected * 4
    # Wide enough to recognise a price rise, narrow enough to reject a one-off
    # purchase at the same merchant.
    return expected * Decimal("0.5") <= actual <= expected * Decimal("1.6")


def matching_transactions(rec: RecurringTransaction, transactions: list[Transaction]) -> list[Transaction]:
    """Charges that belong to this bill, ignoring dates."""
    keys = recurring_keys(rec)
    return [
        tx for tx in transactions
        if tx.account_id is not None
        and _identity_matches(rec, tx, keys)
        and _amount_plausible(rec, tx)
    ]


def _apply_payment(rec: RecurringTransaction, tx: Transaction) -> None:
    actual = Decimal(str(tx.amount))
    current = Decimal(str(rec.amount))
    if rec.is_variable:
        rec.amount = actual
    elif abs(abs(actual) - abs(current)) > max(Decimal("0.50"), abs(current) * Decimal("0.02")):
        rec.previous_amount = current
        rec.amount = actual
        rec.amount_changed_on = tx.transaction_date
    rec.last_paid_date = tx.transaction_date
    rec.last_paid_amount = abs(actual)
    rec.last_transaction_id = tx.id


def reconcile_user(db: Session, user: User, *, today: Optional[date] = None) -> int:
    """Mark bills paid from imported charges. Stages changes; the caller commits.

    Returns how many payments were matched. Safe to run repeatedly: a charge
    already recorded as a bill's last payment, or dated before the bill's
    current window, is never applied twice.
    """
    today = today or user_today(user)
    bills = (
        db.query(RecurringTransaction)
        .filter(RecurringTransaction.user_id == user.id, RecurringTransaction.is_active == True)  # noqa: E712
        .all()
    )
    if not bills:
        return 0

    earliest = min(b.next_date for b in bills) - timedelta(days=31)
    recent = (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user.id,
            Transaction.transaction_date >= earliest,
            Transaction.transaction_date <= today,
        )
        .order_by(Transaction.transaction_date, Transaction.id)
        .all()
    )
    claimed: set[int] = {b.last_transaction_id for b in bills if b.last_transaction_id}

    matched = 0
    for rec in bills:
        before, after = MATCH_WINDOW.get(rec.period, (8, 10))
        candidates = [
            tx for tx in matching_transactions(rec, recent)
            if tx.id not in claimed
            and (rec.last_paid_date is None or tx.transaction_date >= rec.last_paid_date)
        ]
        for tx in candidates:
            try:
                # Step over cycles the bank never showed (a skipped month) so a
                # later charge can still pay its own cycle.
                guard = 0
                while rec.next_date + timedelta(days=after) < tx.transaction_date and guard < 24:
                    rec.next_date = next_occurrence(rec.next_date, rec.period)
                    guard += 1
                if not (rec.next_date - timedelta(days=before) <= tx.transaction_date <= rec.next_date + timedelta(days=after)):
                    continue
                _apply_payment(rec, tx)
                rec.next_date = next_occurrence(rec.next_date, rec.period)
            except UnsupportedPeriodError:
                break
            claimed.add(tx.id)
            matched += 1
    if matched:
        logger.info("recurring_reconciled %s", kv(user_id=user.id, matched=matched))
    return matched


# ─── Status and month totals ──────────────────────────────────────────────────
@dataclass
class BillStatus:
    code: str  # paid | due_soon | upcoming | overdue | waiting | missed | paused
    label: str
    days_until: int


def bill_status(rec: RecurringTransaction, account: Optional[Account], today: date) -> BillStatus:
    days = (rec.next_date - today).days
    if not rec.is_active:
        return BillStatus("paused", "Paused", days)
    if days < 0:
        if is_linked(account):
            _, after = MATCH_WINDOW.get(rec.period, (8, 10))
            if -days <= after:
                return BillStatus("waiting", "Waiting for the bank", days)
            return BillStatus("missed", "Not seen from the bank", days)
        return BillStatus("overdue", "Due — not logged yet", days)
    cycle = CYCLE_DAYS.get(rec.period, 30.44)
    if rec.last_paid_date and (today - rec.last_paid_date).days < min(cycle * 0.6, 20) and days > DUE_SOON_DAYS:
        return BillStatus("paid", "Paid", days)
    if days == 0:
        return BillStatus("due_soon", "Due today", days)
    if days <= DUE_SOON_DAYS:
        return BillStatus("due_soon", f"Due in {days} day{'s' if days != 1 else ''}", days)
    return BillStatus("upcoming", "Upcoming", days)


def month_bounds(today: date) -> tuple[date, date]:
    return today.replace(day=1), today.replace(day=calendar.monthrange(today.year, today.month)[1])


def occurrences_between(rec: RecurringTransaction, start: date, end: date) -> list[date]:
    out: list[date] = []
    cursor = rec.next_date
    for _ in range(60):
        if cursor > end:
            break
        if cursor >= start:
            out.append(cursor)
        try:
            cursor = next_occurrence(cursor, rec.period)
        except UnsupportedPeriodError:
            break
    return out


@dataclass
class MonthFigures:
    paid: Decimal
    remaining: Decimal
    paid_count: int
    remaining_count: int

    @property
    def expected(self) -> Decimal:
        return self.paid + self.remaining


def month_figures(
    rec: RecurringTransaction,
    month_transactions: list[Transaction],
    today: date,
) -> MonthFigures:
    """Paid so far and still due this calendar month, for one bill."""
    start, end = month_bounds(today)
    paid_tx = [t for t in matching_transactions(rec, month_transactions) if start <= t.transaction_date <= today]
    paid = sum((abs(Decimal(str(t.amount))) for t in paid_tx), Decimal("0"))
    due = occurrences_between(rec, start, end) if rec.is_active else []
    remaining = abs(Decimal(str(rec.amount))) * len(due)
    return MonthFigures(paid=paid, remaining=remaining, paid_count=len(paid_tx), remaining_count=len(due))


# ─── Alerts ───────────────────────────────────────────────────────────────────
@dataclass
class Alert:
    title: str
    body: str
    tag: str


def _money(value) -> str:
    return f"${abs(Decimal(str(value))):,.2f}"


def collect_alerts(db: Session, user: User, today: date) -> list[Alert]:
    """Alerts due for this user, marking each as sent. The caller commits and
    delivers; a bill is reminded, flagged as missed, or reported for a price
    change at most once per cycle."""
    bills = (
        db.query(RecurringTransaction)
        .filter(RecurringTransaction.user_id == user.id, RecurringTransaction.is_active == True)  # noqa: E712
        .all()
    )
    accounts = {a.id: a for a in db.query(Account).filter(Account.user_id == user.id).all()}
    alerts: list[Alert] = []

    due = []
    for rec in bills:
        if Decimal(str(rec.amount)) >= 0:
            continue
        account = accounts.get(rec.account_id)
        days = (rec.next_date - today).days

        if 0 <= days <= REMINDER_DAYS and rec.reminder_sent_for != rec.next_date:
            due.append(rec)
            rec.reminder_sent_for = rec.next_date

        _, after = MATCH_WINDOW.get(rec.period, (8, 10))
        if is_linked(account) and -days > after and rec.missed_alert_sent_for != rec.next_date:
            alerts.append(Alert(
                title=f"No {rec.description or 'bill'} charge yet",
                body=f"It was due {rec.next_date:%b} {rec.next_date.day} and hasn't shown up from your bank.",
                tag=f"recurring-missed-{rec.id}",
            ))
            rec.missed_alert_sent_for = rec.next_date

        if (
            rec.previous_amount is not None
            and rec.amount_changed_on is not None
            and (today - rec.amount_changed_on).days <= PRICE_ALERT_RECENT_DAYS
            and rec.price_alert_sent_on != rec.amount_changed_on
            and abs(Decimal(str(rec.amount))) > abs(Decimal(str(rec.previous_amount)))
        ):
            alerts.append(Alert(
                title=f"{rec.description or 'A bill'} went up",
                body=f"Now {_money(rec.amount)}, was {_money(rec.previous_amount)}.",
                tag=f"recurring-price-{rec.id}",
            ))
            rec.price_alert_sent_on = rec.amount_changed_on

    if len(due) == 1:
        rec = due[0]
        days = (rec.next_date - today).days
        when = "today" if days == 0 else "tomorrow" if days == 1 else f"in {days} days"
        prefix = "About " if rec.is_variable else ""
        alerts.insert(0, Alert(
            title=f"{rec.description or 'A bill'} is due {when}",
            body=f"{prefix}{_money(rec.amount)}{' from ' + accounts[rec.account_id].name if rec.account_id in accounts else ''}.",
            tag="recurring-due",
        ))
    elif len(due) > 1:
        total = sum((abs(Decimal(str(r.amount))) for r in due), Decimal("0"))
        alerts.insert(0, Alert(
            title=f"{len(due)} bills due in the next {REMINDER_DAYS} days",
            body=f"{_money(total)} in total: " + ", ".join(r.description or "bill" for r in due[:3]) + ("…" if len(due) > 3 else "."),
            tag="recurring-due",
        ))
    return alerts
