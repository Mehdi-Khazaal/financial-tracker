"""What a transaction counts as: the one rule every total on the server uses.

Mirrors `frontend/src/features/analytics/calculations/transactions.ts`. If you
change a rule here, change it there too.

* **Transfer** — filed under a `transfer` category: money moving between the
  user's own accounts (a card payment from checking, a move to savings). It is
  neither income nor spending, in either direction.
* **Investment** — filed under an `investment` category: money turned into an
  asset (buying gold) or back (selling it). Not spending, not income.
* **Expense** — any other negative amount.
* **Refund** — a positive amount under an expense category; comes off that
  category's spending.
* **Card payment** — any other positive amount on a credit card: the purchases
  were already counted, so the payment is not income.
* **Income** — any other positive amount.

The category rules come first so a purchase (negative) filed as an investment
or a transfer never exits early as an expense.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from models.database import Account, Category, Transaction

# Category types whose transactions are never income or spending.
NOT_SPENDING_CATEGORY_TYPES = frozenset({"investment", "transfer"})


@dataclass
class Lookups:
    account_types: dict[int, str]
    category_types: dict[int, str]


def load_lookups(db: Session, user_id: int) -> Lookups:
    accounts = dict(db.query(Account.id, Account.type).filter(Account.user_id == user_id).all())
    categories = dict(
        db.query(Category.id, Category.type)
        .filter((Category.user_id == user_id) | (Category.user_id.is_(None)))
        .all()
    )
    return Lookups(accounts, categories)


def classify_values(amount, category_id: Optional[int], account_id: Optional[int], lookups: Lookups) -> str:
    amount = Decimal(str(amount or 0))
    if amount == 0:
        return "excluded"
    category_type = lookups.category_types.get(category_id) if category_id is not None else None
    if category_type == "transfer":
        return "transfer"
    if category_type == "investment":
        return "investment"
    if amount < 0:
        return "expense"
    if category_type == "expense":
        return "refund"
    if lookups.account_types.get(account_id) == "credit_card":
        return "card-payment"
    return "income"


def classify(tx: Transaction, lookups: Lookups) -> str:
    return classify_values(tx.amount, tx.category_id, tx.account_id, lookups)
