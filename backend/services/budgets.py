"""Budget progress, computed from the ledger.

One month, one figure per budget: how much of the category's allowance is
spent. Nothing is stored; the numbers are derived on every read so a late
bank import or a re-filed transaction is reflected at once.

Definitions (the same ones Analytics uses, so the two never disagree):

* **Spent** in a category for a month is the sum of the negative amounts on
  transactions filed under it, *minus* any positive amounts filed under it —
  a refund comes back to the category it left.
* **Available** is the month's allowance plus, for a rollover budget, the
  unspent remainder carried from every month since `starts_on`. Overspending
  is never carried: a bad month does not shrink the next one.
* **Remaining** is available minus spent; it goes negative when over.
* Months are the user's calendar months (`utils.dates.user_today`).
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from models.auth import User
from models.database import Budget, Category, Transaction
from utils.dates import user_today
from utils.logging import get_logger, kv

logger = get_logger(__name__)

ZERO = Decimal("0")
CENTS = Decimal("0.01")


def month_key(day: date) -> str:
    return f"{day.year:04d}-{day.month:02d}"


def parse_month(value: Optional[str], fallback: date) -> date:
    """`YYYY-MM` → first of that month; None → first of the fallback's month."""
    if value:
        try:
            year, month = value.split("-")
            return date(int(year), int(month), 1)
        except (ValueError, AttributeError):
            raise ValueError("month must look like YYYY-MM")
    return fallback.replace(day=1)


def month_end(first: date) -> date:
    return first.replace(day=calendar.monthrange(first.year, first.month)[1])


def add_months(first: date, delta: int) -> date:
    index = first.year * 12 + first.month - 1 + delta
    return date(index // 12, index % 12 + 1, 1)


@dataclass
class BudgetProgress:
    budget: Budget
    category_name: str
    category_color: str
    month: str
    amount: Decimal
    carried: Decimal
    available: Decimal
    spent: Decimal
    remaining: Decimal

    @property
    def percent(self) -> Decimal:
        if self.available <= ZERO:
            return Decimal("100") if self.spent > ZERO else ZERO
        return (self.spent / self.available * 100).quantize(Decimal("0.1"))

    @property
    def over(self) -> bool:
        return self.spent > self.available


def _spent_by_month(db: Session, user_id: int, category_ids: list[int], start: date, end: date) -> dict[tuple[int, str], Decimal]:
    """Net spend per (category, month) over [start, end]. One query."""
    if not category_ids:
        return {}
    rows = (
        db.query(Transaction.category_id, Transaction.transaction_date, Transaction.amount)
        .filter(
            Transaction.user_id == user_id,
            Transaction.category_id.in_(category_ids),
            Transaction.transaction_date >= start,
            Transaction.transaction_date <= end,
        )
        .all()
    )
    totals: dict[tuple[int, str], Decimal] = {}
    for category_id, day, amount in rows:
        key = (category_id, month_key(day))
        # Expenses are negative in the ledger; a refund is positive and nets out.
        totals[key] = totals.get(key, ZERO) - Decimal(str(amount))
    return totals


def progress_for_month(db: Session, user: User, month: date) -> list[BudgetProgress]:
    """Every active budget's figures for the month starting on `month`."""
    budgets = (
        db.query(Budget)
        .filter(Budget.user_id == user.id, Budget.is_active.is_(True), Budget.starts_on <= month_end(month))
        .order_by(Budget.id)
        .all()
    )
    if not budgets:
        return []
    names = {
        c.id: (c.name, c.color)
        for c in db.query(Category).filter(Category.id.in_([b.category_id for b in budgets])).all()
    }
    # Rollover budgets need every month since they started; the rest only this one.
    window_start = min((b.starts_on for b in budgets if b.rollover), default=month)
    window_start = min(window_start, month)
    spent = _spent_by_month(db, user.id, [b.category_id for b in budgets], window_start, month_end(month))

    out: list[BudgetProgress] = []
    this_key = month_key(month)
    for budget in budgets:
        amount = Decimal(str(budget.amount))
        carried = ZERO
        if budget.rollover:
            cursor = budget.starts_on.replace(day=1)
            while cursor < month:
                carried = max(ZERO, carried + amount - spent.get((budget.category_id, month_key(cursor)), ZERO))
                cursor = add_months(cursor, 1)
        this_month = spent.get((budget.category_id, this_key), ZERO)
        available = amount + carried
        name, color = names.get(budget.category_id, ("Category", "#5b8fff"))
        out.append(BudgetProgress(
            budget=budget,
            category_name=name,
            category_color=color,
            month=this_key,
            amount=amount.quantize(CENTS),
            carried=carried.quantize(CENTS),
            available=available.quantize(CENTS),
            spent=this_month.quantize(CENTS),
            remaining=(available - this_month).quantize(CENTS),
        ))
    return out


def notify_over_budget(db: Session, user: User, send) -> int:
    """Push once per budget per month when spending has passed the allowance.

    `send(db, user_id, title, body, url, tag)` is injected so the caller
    decides delivery (the real push sender in production, a recorder in
    tests). Marks each budget before sending, so a failed send is not retried
    every night — the next month gets its own notice.
    """
    from services import user_preferences

    if not user_preferences.alerts_enabled(db, user.id, "budget"):
        return 0
    month = user_today(user).replace(day=1)
    sent = 0
    for item in progress_for_month(db, user, month):
        if not item.over or item.budget.notified_month == item.month:
            continue
        item.budget.notified_month = item.month
        db.commit()
        over_by = (item.spent - item.available).quantize(CENTS)
        send(
            db,
            user.id,
            f"Over budget: {item.category_name}",
            f"${item.spent:,.2f} of ${item.available:,.2f} — ${over_by:,.2f} over so far this month.",
            url="/?tab=analytics",
            tag=f"budget-{item.budget.id}-{item.month}",
        )
        sent += 1
    if sent:
        logger.info("budget_alerts_sent %s", kv(user_id=user.id, count=sent))
    return sent
