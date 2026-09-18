"""Split transactions: one charge, several categories.

A split never moves money. The parent transaction keeps its amount, its
account and therefore its whole effect on the balance; the split lines only
say how that amount is *filed*. So the rules are about attribution:

* **Lines add up to the parent exactly** — `Decimal`, to the cent, no
  tolerance. A split that is a cent off would make a category total disagree
  with the ledger forever.
* **Every line has the parent's sign** and is non-zero. A refund inside a
  purchase is a separate transaction, not a negative line.
* **Two to twenty lines, one per category.** Two lines in the same category
  are one line.
* **The parent keeps a real category**: the largest line's. Anything that is
  not split-aware (the review board, a CSV export, an older client) still
  files the whole amount somewhere sensible instead of reading it as
  uncategorised; everything that is split-aware — budgets, the assistant's
  category totals, the analytics category views — reads the lines.
* **A split is only valid for the amount it was made for.** When the parent's
  amount changes (an edit, or the bank revising the charge) or the user files
  the whole transaction under one category, the lines are dropped.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from models.database import Category, Transaction, TransactionSplit

CENTS = Decimal("0.01")
MIN_LINES = 2
MAX_LINES = 20


class InvalidSplit(ValueError):
    """The lines cannot be accepted as given. The message is shown to the user."""


class SplitCategoryNotFound(LookupError):
    """A line names a category this user cannot use."""


@dataclass(frozen=True)
class SplitLine:
    category_id: int
    amount: Decimal
    note: Optional[str] = None


def _money(value: Decimal) -> str:
    return f"${abs(value):,.2f}"


def validate(parent_amount: Decimal, lines: list[SplitLine]) -> list[SplitLine]:
    """Return the lines normalised to cents, or raise `InvalidSplit`."""
    if not MIN_LINES <= len(lines) <= MAX_LINES:
        raise InvalidSplit(f"A split needs between {MIN_LINES} and {MAX_LINES} parts")
    parent = Decimal(str(parent_amount))
    if parent == 0:
        raise InvalidSplit("A zero-amount transaction cannot be split")
    seen: set[int] = set()
    normalised: list[SplitLine] = []
    for line in lines:
        amount = Decimal(str(line.amount))
        if amount != amount.quantize(CENTS):
            raise InvalidSplit("Amounts can have at most two decimal places")
        if amount == 0:
            raise InvalidSplit("Each part needs an amount")
        if (amount < 0) != (parent < 0):
            raise InvalidSplit("Each part must go the same way as the transaction")
        if line.category_id in seen:
            raise InvalidSplit("Each category can appear once in a split")
        seen.add(line.category_id)
        note = (line.note or "").strip() or None
        normalised.append(SplitLine(line.category_id, amount.quantize(CENTS), note[:200] if note else None))
    total = sum((line.amount for line in normalised), Decimal("0"))
    if total != parent.quantize(CENTS):
        raise InvalidSplit(f"The parts add up to {_money(total)}; the transaction is {_money(parent)}")
    return normalised


def _check_categories(db: Session, user_id: int, category_ids: Iterable[int]) -> None:
    wanted = set(category_ids)
    found = {
        row[0]
        for row in db.query(Category.id)
        .filter(Category.id.in_(wanted))
        .filter(or_(Category.user_id == user_id, Category.user_id.is_(None)))
        .all()
    }
    if found != wanted:
        raise SplitCategoryNotFound("Category not found")


def replace(db: Session, user_id: int, transaction: Transaction, lines: list[SplitLine]) -> Transaction:
    """Validate and store the lines, re-filing the parent under the largest. Stages only."""
    normalised = validate(Decimal(str(transaction.amount)), lines)
    _check_categories(db, user_id, (line.category_id for line in normalised))
    transaction.splits.clear()
    db.flush()
    for line in normalised:
        transaction.splits.append(TransactionSplit(
            user_id=user_id, category_id=line.category_id, amount=line.amount, note=line.note,
        ))
    largest = max(normalised, key=lambda line: abs(line.amount))  # first wins a tie
    transaction.category_id = largest.category_id
    transaction.category_source = "user"
    return transaction


def clear(transaction: Transaction) -> bool:
    """Drop the lines, keeping the parent's category. Stages only."""
    if not transaction.splits:
        return False
    transaction.splits.clear()
    return True


def clear_by_id(db: Session, transaction_id: int) -> int:
    """Bulk form for paths that never loaded the collection (bank sync)."""
    return (
        db.query(TransactionSplit)
        .filter(TransactionSplit.transaction_id == transaction_id)
        .delete(synchronize_session=False)
    )


def split_parent_ids(user_id: int):
    """Subquery of this user's split parents — excluded wherever lines are read instead."""
    from sqlalchemy import select

    return select(TransactionSplit.transaction_id).where(TransactionSplit.user_id == user_id)
