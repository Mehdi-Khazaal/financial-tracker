"""The paycheck plan: what each paycheck is for, ticked off as it happens.

The owner kept asking the assistant the same things: how many paychecks are
left this year, whether $1,500 from each one reaches Summer 2027, whether the
goal is on track. This answers them on the page, every payday.

* **Paycheck sources** are payers (merchant keys) whose deposits are pay. A
  **payday** is a date on which any of them deposited; two employers paying on
  the same Friday make one payday, the way the money actually arrives.
* **Bills** are the declared recurring charges that fall due from this payday
  up to the next one, plus any already paid since this payday. That money is
  spoken for before anything else.
* **Lines** put a fixed amount toward a goal every payday, kept in a chosen
  account. Ticking one off records it, and by default also sets the amount
  aside for the goal in that account, if the account has that much not set
  aside yet. Nothing moves money: ticking says the user moved it.
* **Free** is the paycheck less bills and lines.

The next payday is the last one plus the usual gap between paydays (the
median of recent gaps, two weeks when there is not enough history yet).
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Iterable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from models.database import (
    Account,
    PaycheckCheckoff,
    PaycheckLine,
    PaycheckPlan,
    PaycheckSource,
    RecurringTransaction,
    SavingsGoal,
    SavingsGoalAllocation,
    Transaction,
)
from services.classification import classify, load_lookups
from services.merchants import display_name, merchant_key
from services.recurring_schedule import UnsupportedPeriodError, next_occurrence

ZERO = Decimal("0")
DEFAULT_GAP_DAYS = 14
# History read to find paydays and suggest sources.
HISTORY_DAYS = 180
# A payday is announced, and shown first, while it is this recent.
RECENT_DAYS = 6
DAYS_PER_MONTH = Decimal("30.4375")
# A regular deposit smaller than this is interest or cashback, not pay.
MIN_TYPICAL_PAYCHECK = Decimal("100")


class PlanError(Exception):
    """A request the plan cannot carry out, with a message for the user."""


class NotEnoughFree(PlanError):
    def __init__(self, account_name: str, available: Decimal, amount: Decimal):
        self.available = available
        super().__init__(
            f"{account_name} has {_money(available)} not set aside yet, so {_money(amount)} cannot be set aside there. "
            "Move the money first, or mark it done without setting it aside."
        )


def _money(value: Decimal) -> str:
    return f"${value:,.2f}"


def _key_of(tx: Transaction) -> str:
    return tx.merchant_key or merchant_key(tx.description)


# ─── Paydays ──────────────────────────────────────────────────────────────────
@dataclass
class Deposit:
    transaction_id: int
    name: str
    amount: Decimal
    account_id: int


@dataclass
class Payday:
    on: date
    deposits: list[Deposit] = field(default_factory=list)

    @property
    def amount(self) -> Decimal:
        return sum((d.amount for d in self.deposits), ZERO)


def paydays(db: Session, user_id: int, source_keys: Iterable[str], today: date) -> list[Payday]:
    """Paydays in the last `HISTORY_DAYS`, oldest first."""
    keys = set(source_keys)
    if not keys:
        return []
    rows = (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user_id,
            Transaction.amount > 0,
            Transaction.transaction_date >= today - timedelta(days=HISTORY_DAYS),
            Transaction.transaction_date <= today,
        )
        .order_by(Transaction.transaction_date, Transaction.id)
        .all()
    )
    by_day: dict[date, Payday] = {}
    for tx in rows:
        if _key_of(tx) not in keys:
            continue
        day = by_day.setdefault(tx.transaction_date, Payday(on=tx.transaction_date))
        day.deposits.append(Deposit(tx.id, display_name(tx.description or ""), Decimal(str(tx.amount)), tx.account_id))
    return [by_day[d] for d in sorted(by_day)]


def usual_gap_days(days: list[Payday]) -> int:
    """The median gap between recent paydays, or two weeks without enough history."""
    dates = [p.on for p in days[-7:]]
    gaps = [(b - a).days for a, b in zip(dates, dates[1:]) if (b - a).days > 0]
    if not gaps:
        return DEFAULT_GAP_DAYS
    return max(1, round(statistics.median(gaps)))


def paydays_per_month(gap_days: int) -> Decimal:
    return DAYS_PER_MONTH / Decimal(gap_days)


@dataclass
class SourceSuggestion:
    merchant_key: str
    name: str
    count: int
    typical_amount: Decimal
    gap_days: int


def suggest_sources(db: Session, user_id: int, today: date) -> list[SourceSuggestion]:
    """Payers that deposit income on a regular rhythm: probably paychecks.

    Three or more deposits in the window, at a usual gap of one to five weeks,
    typically at least `MIN_TYPICAL_PAYCHECK`. A one-off (a scholarship, a
    refund) is not suggested, and neither is a small regular credit such as
    savings interest: the setup sheet ticks every suggestion the first time,
    and $0.11 of interest a month is not a payday.
    """
    lookups = load_lookups(db, user_id)
    rows = (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user_id,
            Transaction.amount > 0,
            Transaction.transaction_date >= today - timedelta(days=HISTORY_DAYS),
            Transaction.transaction_date <= today,
        )
        .all()
    )
    groups: dict[str, list[Transaction]] = {}
    for tx in rows:
        key = _key_of(tx)
        if key and classify(tx, lookups) == "income":
            groups.setdefault(key, []).append(tx)
    found = []
    for key, txs in groups.items():
        dates = sorted({t.transaction_date for t in txs})
        if len(dates) < 3:
            continue
        gaps = [(b - a).days for a, b in zip(dates, dates[1:])]
        gap = round(statistics.median(gaps))
        if not 6 <= gap <= 35:
            continue
        typical = Decimal(str(statistics.median([Decimal(str(t.amount)) for t in txs]))).quantize(Decimal("0.01"))
        if typical < MIN_TYPICAL_PAYCHECK:
            continue
        latest = max(txs, key=lambda t: t.transaction_date)
        found.append(SourceSuggestion(
            merchant_key=key,
            name=display_name(latest.description or key),
            count=len(dates),
            typical_amount=typical,
            gap_days=gap,
        ))
    found.sort(key=lambda s: (-s.count, s.name))
    return found


# ─── Bills before the next payday ─────────────────────────────────────────────
@dataclass
class BillDue:
    name: str
    amount: Decimal
    on: date
    paid: bool


def bills_between(db: Session, user_id: int, start: date, end: date, today: date) -> list[BillDue]:
    """Declared bills paid since `start`, and due from `start` up to (not including) `end`."""
    bills = (
        db.query(RecurringTransaction)
        .filter(
            RecurringTransaction.user_id == user_id,
            RecurringTransaction.is_active.is_(True),
            RecurringTransaction.amount < 0,
        )
        .all()
    )
    out: list[BillDue] = []
    for bill in bills:
        amount = abs(Decimal(str(bill.amount)))
        name = bill.description or "Bill"
        if bill.last_paid_date and start <= bill.last_paid_date <= today:
            out.append(BillDue(name, amount, bill.last_paid_date, True))
        due = bill.next_date
        for _ in range(60):
            if due >= end:
                break
            if due >= start:
                out.append(BillDue(name, amount, due, False))
            try:
                due = next_occurrence(due, bill.period)
            except UnsupportedPeriodError:
                break
    out.sort(key=lambda b: (b.on, b.name))
    return out


# ─── The plan for one payday ──────────────────────────────────────────────────
@dataclass
class LineState:
    line: PaycheckLine
    done: bool
    set_aside: bool


@dataclass
class PaydayPlan:
    payday: Payday
    next_payday: date
    bills: list[BillDue]
    lines: list[LineState]

    @property
    def bills_total(self) -> Decimal:
        return sum((b.amount for b in self.bills), ZERO)

    @property
    def planned_total(self) -> Decimal:
        return sum((Decimal(str(s.line.amount)) for s in self.lines), ZERO)

    @property
    def free(self) -> Decimal:
        return self.payday.amount - self.bills_total - self.planned_total


def get_plan(db: Session, user_id: int) -> Optional[PaycheckPlan]:
    return db.query(PaycheckPlan).filter(PaycheckPlan.user_id == user_id).first()


def plan_for_payday(db: Session, plan: PaycheckPlan, payday: Payday, gap_days: int, today: date) -> PaydayPlan:
    next_payday = payday.on + timedelta(days=gap_days)
    ticks = {
        c.line_id: c
        for c in db.query(PaycheckCheckoff).filter(
            PaycheckCheckoff.user_id == plan.user_id, PaycheckCheckoff.payday == payday.on
        )
    }
    return PaydayPlan(
        payday=payday,
        next_payday=next_payday,
        bills=bills_between(db, plan.user_id, payday.on, next_payday, today),
        lines=[
            LineState(line, line.id in ticks, bool(ticks[line.id].set_aside) if line.id in ticks else False)
            for line in plan.lines
        ],
    )


def latest_payday_plan(db: Session, plan: PaycheckPlan, today: date) -> tuple[Optional[PaydayPlan], int]:
    """The most recent payday's plan, and the usual gap between paydays."""
    days = paydays(db, plan.user_id, [s.merchant_key for s in plan.sources], today)
    gap = usual_gap_days(days)
    if not days:
        return None, gap
    return plan_for_payday(db, plan, days[-1], gap, today), gap


# ─── Saving the plan ──────────────────────────────────────────────────────────
@dataclass
class LineInput:
    goal_id: int
    amount: Decimal
    account_id: Optional[int]


def save_plan(
    db: Session,
    user_id: int,
    *,
    sources: list[tuple[str, str]],
    lines: list[LineInput],
    notify: bool,
) -> PaycheckPlan:
    """Replace the user's plan with these sources and lines."""
    goal_ids = {g for (g,) in db.query(SavingsGoal.id).filter(SavingsGoal.user_id == user_id)}
    account_ids = {a for (a,) in db.query(Account.id).filter(Account.user_id == user_id)}
    seen_goals: set[int] = set()
    for line in lines:
        if line.goal_id not in goal_ids:
            raise PlanError("A line points at a goal that does not exist.")
        if line.account_id is not None and line.account_id not in account_ids:
            raise PlanError("A line points at an account that does not exist.")
        if line.goal_id in seen_goals:
            raise PlanError("Each goal can appear once in the plan.")
        if line.amount <= 0:
            raise PlanError("Each line needs an amount above zero.")
        seen_goals.add(line.goal_id)

    plan = get_plan(db, user_id)
    if plan is None:
        plan = PaycheckPlan(user_id=user_id)
        db.add(plan)
        db.flush()
    plan.notify = notify

    existing_lines = {line.goal_id: line for line in plan.lines}
    keep: list[PaycheckLine] = []
    for position, item in enumerate(lines):
        line = existing_lines.get(item.goal_id)
        if line is None:
            line = PaycheckLine(user_id=user_id, plan_id=plan.id, goal_id=item.goal_id)
        line.amount = item.amount
        line.account_id = item.account_id
        line.position = position
        keep.append(line)
    plan.lines = keep

    unique_sources: dict[str, str] = {}
    for key, name in sources:
        key = (key or "").strip()
        if key and key not in unique_sources:
            unique_sources[key] = (name or key).strip()[:120]
    existing_sources = {s.merchant_key: s for s in plan.sources}
    plan.sources = [
        existing_sources.get(key) or PaycheckSource(user_id=user_id, plan_id=plan.id, merchant_key=key, name=name)
        for key, name in unique_sources.items()
    ]
    db.commit()
    db.refresh(plan)
    return plan


# ─── Ticking a line off ───────────────────────────────────────────────────────
def _free_in_account(db: Session, user_id: int, account: Account) -> Decimal:
    promised = (
        db.query(func.coalesce(func.sum(SavingsGoalAllocation.amount), 0))
        .filter(SavingsGoalAllocation.user_id == user_id, SavingsGoalAllocation.account_id == account.id)
        .scalar()
    )
    return Decimal(str(account.balance or 0)) - Decimal(str(promised))


def tick(db: Session, user_id: int, line_id: int, payday: date, set_aside: bool) -> PaycheckCheckoff:
    """Mark a line done for a payday, setting its amount aside if asked."""
    line = (
        db.query(PaycheckLine)
        .filter(PaycheckLine.id == line_id, PaycheckLine.user_id == user_id)
        .first()
    )
    if line is None:
        raise LookupError("Line not found")
    existing = (
        db.query(PaycheckCheckoff)
        .filter(PaycheckCheckoff.line_id == line.id, PaycheckCheckoff.payday == payday)
        .first()
    )
    if existing is not None:
        return existing

    amount = Decimal(str(line.amount))
    account = db.get(Account, line.account_id) if line.account_id else None
    if set_aside:
        if account is None or account.user_id != user_id:
            raise PlanError("Choose an account for this line before setting money aside.")
        available = _free_in_account(db, user_id, account)
        if amount > available:
            raise NotEnoughFree(account.name, max(ZERO, available), amount)
        allocation = (
            db.query(SavingsGoalAllocation)
            .filter(
                SavingsGoalAllocation.user_id == user_id,
                SavingsGoalAllocation.goal_id == line.goal_id,
                SavingsGoalAllocation.account_id == account.id,
            )
            .first()
        )
        if allocation is None:
            db.add(SavingsGoalAllocation(user_id=user_id, goal_id=line.goal_id, account_id=account.id, amount=amount))
        else:
            allocation.amount = Decimal(str(allocation.amount)) + amount

    checkoff = PaycheckCheckoff(
        user_id=user_id,
        line_id=line.id,
        payday=payday,
        amount=amount,
        set_aside=set_aside,
        account_id=account.id if (set_aside and account) else None,
    )
    db.add(checkoff)
    db.commit()
    db.refresh(checkoff)
    return checkoff


def untick(db: Session, user_id: int, line_id: int, payday: date) -> None:
    """Undo a tick. Money it set aside is taken back off the goal."""
    checkoff = (
        db.query(PaycheckCheckoff)
        .filter(
            PaycheckCheckoff.user_id == user_id,
            PaycheckCheckoff.line_id == line_id,
            PaycheckCheckoff.payday == payday,
        )
        .first()
    )
    if checkoff is None:
        return
    if checkoff.set_aside and checkoff.account_id is not None:
        line = db.get(PaycheckLine, checkoff.line_id)
        allocation = (
            db.query(SavingsGoalAllocation)
            .filter(
                SavingsGoalAllocation.user_id == user_id,
                SavingsGoalAllocation.goal_id == line.goal_id,
                SavingsGoalAllocation.account_id == checkoff.account_id,
            )
            .first()
        ) if line else None
        if allocation is not None:
            remaining = Decimal(str(allocation.amount)) - Decimal(str(checkoff.amount))
            if remaining > ZERO:
                allocation.amount = remaining
            else:
                db.delete(allocation)
    db.delete(checkoff)
    db.commit()


# ─── Payday push ──────────────────────────────────────────────────────────────
def payday_message(plan: PaydayPlan) -> tuple[str, str]:
    """The push for a payday: what arrived, what is spoken for, what is free."""
    title = f"Payday: {_money(plan.payday.amount)} arrived"
    parts = []
    if plan.bills:
        parts.append(f"Bills before {plan.next_payday.strftime('%b')} {plan.next_payday.day}: {_money(plan.bills_total)}")
    for state in plan.lines[:3]:
        parts.append(f"{state.line.goal.name if state.line.goal else 'Goal'} {_money(Decimal(str(state.line.amount)))}")
    parts.append(f"Free: {_money(plan.free)}")
    return title, " · ".join(parts)


def payday_to_announce(db: Session, user_id: int, today: date) -> Optional[PaydayPlan]:
    """The payday to push about now, or None: recent, not yet announced, notifications on."""
    plan = get_plan(db, user_id)
    if plan is None or not plan.notify or not plan.sources:
        return None
    current, _ = latest_payday_plan(db, plan, today)
    if current is None or (today - current.payday.on).days > RECENT_DAYS:
        return None
    if plan.last_notified_payday is not None and plan.last_notified_payday >= current.payday.on:
        return None
    return current


def mark_announced(db: Session, user_id: int, payday: date) -> None:
    plan = get_plan(db, user_id)
    if plan is not None:
        plan.last_notified_payday = payday
        db.commit()
