"""How much cash is free, set aside, or cover for an emergency.

Mirrors `frontend/src/features/accounts/calculations/totals.ts`.

Goal allocations are labels on balances you already hold. They used to be
ignored here, so the $4,910 in a cash account set aside entirely for a summer
trip counted as "available to spend", and $8,910 promised to four goals counted
as emergency cover. Now:

* **Available to spend** — checking and cash, less whatever is set aside in
  those accounts for any goal (the emergency fund included: it is not for
  everyday spending either).
* **Emergency cash** — checking, savings and cash, less what is set aside for
  goals other than the emergency fund. Money not promised to anything, plus
  the emergency fund itself, is what you could fall back on.

Each account is clamped on its own: an account cannot free more than it holds,
and over-allocating one account does not eat into another. A negative balance
(an overdraft) still counts as it is.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy.orm import Session

from models.database import Account, SavingsGoal, SavingsGoalAllocation

ZERO = Decimal("0")
SPENDABLE_TYPES = frozenset({"checking", "cash"})
LIQUID_TYPES = frozenset({"checking", "savings", "cash"})


@dataclass(frozen=True)
class CashPosition:
    liquid: Decimal
    available_to_spend: Decimal
    set_aside: Decimal
    emergency_cash: Decimal


def _free(balance: Decimal, promised: Decimal) -> Decimal:
    if balance <= ZERO:
        return balance
    return max(ZERO, balance - promised)


def cash_position(db: Session, user_id: int) -> CashPosition:
    accounts = db.query(Account).filter(Account.user_id == user_id).all()
    rows = (
        db.query(SavingsGoalAllocation.account_id, SavingsGoalAllocation.amount, SavingsGoal.is_emergency_fund)
        .join(SavingsGoal, SavingsGoal.id == SavingsGoalAllocation.goal_id)
        .filter(SavingsGoalAllocation.user_id == user_id)
        .all()
    )
    all_goals: dict[int, Decimal] = {}
    other_goals: dict[int, Decimal] = {}
    for account_id, amount, is_emergency in rows:
        amount = Decimal(str(amount))
        all_goals[account_id] = all_goals.get(account_id, ZERO) + amount
        if not is_emergency:
            other_goals[account_id] = other_goals.get(account_id, ZERO) + amount

    liquid = available = set_aside = emergency = ZERO
    for account in accounts:
        if account.type not in LIQUID_TYPES:
            continue
        balance = Decimal(str(account.balance or 0))
        liquid += balance
        set_aside += all_goals.get(account.id, ZERO)
        emergency += _free(balance, other_goals.get(account.id, ZERO))
        if account.type in SPENDABLE_TYPES:
            available += _free(balance, all_goals.get(account.id, ZERO))
    return CashPosition(liquid=liquid, available_to_spend=available, set_aside=set_aside, emergency_cash=emergency)
