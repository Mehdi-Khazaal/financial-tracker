"""The weekly summary: one Sunday push about the week behind and the week ahead.

What it says, in this order, and only what is true:

  1. What was spent in the last seven days, and where most of it went.
  2. Bills due in the next seven days.
  3. The budget closest to its limit this month, once it is three-quarters used.

Spending follows the app's own definition (the frontend's `classifyTransaction`):
a negative transaction is spending unless it is filed as an investment, and a
positive one filed under an expense category is a refund that takes spending
back down. Transfers live in their own table and never appear here. Split
transactions are read line by line, so the top category is the real one.

Once a week per user: `UserPreferences.weekly_summary_sent_on` is set before
the push goes out, and anyone who had one in the last six days is skipped, so a
cron that fires twice sends once. A week with nothing to say sends nothing.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from models.auth import User
from models.database import Category, RecurringTransaction, Transaction, TransactionSplit
from services import user_preferences
from services.classification import NOT_SPENDING_CATEGORY_TYPES
from utils.dates import user_today
from utils.logging import get_logger, kv

logger = get_logger(__name__)

ZERO = Decimal("0")
WINDOW_DAYS = 7
RESEND_AFTER_DAYS = 6
BUDGET_MENTION_PERCENT = Decimal("75")


def _money(value: Decimal) -> str:
    """Whole dollars once the cents stop mattering, as in "$412" or "$8.50"."""
    return f"${value:,.0f}" if value >= 100 else f"${value:,.2f}"


@dataclass
class WeeklySummary:
    spent: Decimal
    top_category: Optional[str]
    top_amount: Decimal
    bills_count: int
    bills_total: Decimal
    budget_name: Optional[str]
    budget_percent: Optional[Decimal]

    @property
    def has_news(self) -> bool:
        return self.spent > ZERO or self.bills_count > 0 or self.budget_name is not None

    def body(self) -> str:
        parts = []
        if self.spent > ZERO:
            line = f"You spent {_money(self.spent)} in the last 7 days"
            if self.top_category and self.top_amount > ZERO:
                line += f", most on {self.top_category} ({_money(self.top_amount)})"
            parts.append(line + ".")
        else:
            parts.append("No spending in the last 7 days.")
        if self.bills_count:
            noun = "bill" if self.bills_count == 1 else "bills"
            parts.append(f"{self.bills_count} {noun} due this week, {_money(self.bills_total)} in all.")
        if self.budget_name is not None and self.budget_percent is not None:
            parts.append(f"{self.budget_name} budget is {self.budget_percent:.0f}% used.")
        return " ".join(parts)


def build_summary(db: Session, user: User, today: date) -> WeeklySummary:
    """The figures for the seven days before `today` and the seven from it."""
    start = today - timedelta(days=WINDOW_DAYS)
    end = today - timedelta(days=1)

    categories = {
        row.id: row
        for row in db.query(Category.id, Category.name, Category.type)
        .filter(or_(Category.user_id == user.id, Category.user_id.is_(None)))
        .all()
    }

    rows = (
        db.query(Transaction.id, Transaction.category_id, Transaction.amount)
        .filter(
            Transaction.user_id == user.id,
            Transaction.transaction_date >= start,
            Transaction.transaction_date <= end,
        )
        .all()
    )
    lines_by_parent: dict[int, list[tuple[Optional[int], Decimal]]] = {}
    if rows:
        for parent_id, category_id, amount in (
            db.query(TransactionSplit.transaction_id, TransactionSplit.category_id, TransactionSplit.amount)
            .filter(TransactionSplit.user_id == user.id, TransactionSplit.transaction_id.in_([r.id for r in rows]))
            .all()
        ):
            lines_by_parent.setdefault(parent_id, []).append((category_id, Decimal(str(amount))))

    spent = ZERO
    by_category: dict[Optional[int], Decimal] = {}
    for row in rows:
        for category_id, amount in lines_by_parent.get(row.id, [(row.category_id, Decimal(str(row.amount)))]):
            kind = categories[category_id].type if category_id in categories else None
            # Buying an asset or moving money between your own accounts is not spending.
            if amount < 0 and kind not in NOT_SPENDING_CATEGORY_TYPES:
                delta = -amount
            elif amount > 0 and kind == "expense":
                delta = -amount  # a refund
            else:
                continue
            spent += delta
            by_category[category_id] = by_category.get(category_id, ZERO) + delta

    named = [(cid, total) for cid, total in by_category.items() if cid in categories and total > ZERO]
    top_id, top_amount = max(named, key=lambda item: item[1]) if named else (None, ZERO)

    bills = (
        db.query(RecurringTransaction.amount)
        .filter(
            RecurringTransaction.user_id == user.id,
            RecurringTransaction.is_active.is_(True),
            RecurringTransaction.amount < 0,
            RecurringTransaction.next_date >= today,
            RecurringTransaction.next_date <= today + timedelta(days=WINDOW_DAYS - 1),
        )
        .all()
    )

    from services.budgets import progress_for_month

    budget_name: Optional[str] = None
    budget_percent: Optional[Decimal] = None
    progress = [p for p in progress_for_month(db, user, today.replace(day=1)) if p.percent >= BUDGET_MENTION_PERCENT]
    if progress:
        closest = max(progress, key=lambda p: p.percent)
        budget_name, budget_percent = closest.category_name, closest.percent

    return WeeklySummary(
        spent=max(spent, ZERO),
        top_category=categories[top_id].name if top_id is not None else None,
        top_amount=top_amount,
        bills_count=len(bills),
        bills_total=sum((abs(Decimal(str(b.amount))) for b in bills), ZERO),
        budget_name=budget_name,
        budget_percent=budget_percent,
    )


def send_weekly_summary(db: Session, user: User, send) -> bool:
    """Send this user's summary if it is due and has something to say.

    `send(db, user_id, title, body, url, tag)` is injected so the caller
    decides delivery. Marks before sending, so a delivery failure is not
    retried until next week.
    """
    if not user_preferences.stored_values(db, user.id)["weekly_summary_enabled"]:
        return False
    today = user_today(user)
    row = user_preferences.get_row(db, user.id)
    last = row.weekly_summary_sent_on if row is not None else None
    if last is not None and (today - last).days < RESEND_AFTER_DAYS:
        return False

    summary = build_summary(db, user, today)
    if not summary.has_news:
        return False

    user_preferences.upsert(db, user.id, {"weekly_summary_sent_on": today})
    db.commit()
    send(db, user.id, "Your week", summary.body(), url="/?tab=analytics", tag="weekly-summary")
    return True


def send_weekly_summaries(db: Session, send) -> dict:
    """Everyone who can receive a push. Used by the weekly cron."""
    from models.push import PushSubscription

    user_ids = [row[0] for row in db.query(PushSubscription.user_id).distinct().all()]
    sent = 0
    for user_id in user_ids:
        owner = db.query(User).filter(User.id == user_id).first()
        if owner is None:
            continue
        try:
            if send_weekly_summary(db, owner, send):
                sent += 1
        except Exception:
            db.rollback()
            logger.exception("weekly_summary_failed %s", kv(user_id=user_id))
    if sent:
        logger.info("weekly_summaries_sent %s", kv(count=sent))
    return {"users": len(user_ids), "sent": sent}
