"""Find uncategorized rows that look like money moving between the user's own accounts.

Nothing here changes data. The Review tab shows these as suggestions, and a
row is filed under the Transfer category only when the user confirms it.

Three signals, strongest first:

* **A pair.** The same amount leaves one of the user's accounts and arrives in
  another within `PAIR_WINDOW_DAYS`: a card payment from checking, a move to
  savings. Both rows are suggested together.
* **A payment into a card** with no matching row elsewhere, typically paid from
  an account that is not linked. Already left out of income by the card-payment
  rule; filing it as a transfer says so explicitly and clears it from Review.
* **The bank says so.** Plaid's own category marks the row as a credit-card
  payment or a move to savings or investments.

Only uncategorized rows are considered, so a suggestion disappears as soon as
the user files the row under anything, Transfer or not.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from models.database import Account, Category, Transaction
from services.splits import split_parent_ids

PAIR_WINDOW_DAYS = 4
MAX_SUGGESTIONS = 200

# Plaid's detailed categories for moves between a person's own accounts. Kept
# narrow on purpose: Zelle and Venmo to other people land in broader transfer
# categories and are real spending.
BANK_TRANSFER_CATEGORIES = {
    "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT": "Your bank marks this as a credit card payment.",
    "TRANSFER_OUT_SAVINGS": "Your bank marks this as a move to savings.",
    "TRANSFER_IN_SAVINGS": "Your bank marks this as a move from savings.",
    "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS": "Your bank marks this as a move to an investment account.",
    "TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS": "Your bank marks this as a move from an investment account.",
}
# A cash withdrawal is a move only for someone who tracks the cash as an
# account; for everyone else it is spending.
CASH_WITHDRAWAL = "TRANSFER_OUT_WITHDRAWAL"


@dataclass
class TransferSuggestion:
    transaction_ids: list[int]
    # "pair" | "card-payment" | "bank-category"
    reason: str
    detail: str
    amount: Decimal
    on: date
    from_account_id: Optional[int] = None
    to_account_id: Optional[int] = None
    descriptions: list[str] = field(default_factory=list)


def _name(accounts: dict[int, Account], account_id: Optional[int]) -> str:
    account = accounts.get(account_id) if account_id is not None else None
    return account.name if account else "another account"


def _days(n: int) -> str:
    return "the same day" if n == 0 else ("1 day later" if n == 1 else f"{n} days later")


def suggest(db: Session, user_id: int) -> list[TransferSuggestion]:
    accounts = {a.id: a for a in db.query(Account).filter(Account.user_id == user_id).all()}
    rows = (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user_id,
            Transaction.category_id.is_(None),
            Transaction.amount != 0,
            ~Transaction.id.in_(split_parent_ids(user_id)),
        )
        .order_by(Transaction.transaction_date.desc(), Transaction.id.desc())
        .all()
    )
    if not rows:
        return []

    outgoing = [t for t in rows if t.amount < 0]
    incoming_by_amount: dict[Decimal, list[Transaction]] = {}
    for t in rows:
        if t.amount > 0:
            incoming_by_amount.setdefault(Decimal(str(t.amount)), []).append(t)
    used: set[int] = set()
    found: list[TransferSuggestion] = []

    # Pairs: each outflow takes the nearest-dated unused inflow of the same
    # amount on a different account.
    for out in outgoing:
        amount = -Decimal(str(out.amount))
        best: Optional[Transaction] = None
        best_gap = PAIR_WINDOW_DAYS + 1
        for into in incoming_by_amount.get(amount, ()):
            if into.id in used or into.account_id == out.account_id:
                continue
            gap = abs((into.transaction_date - out.transaction_date).days)
            if gap < best_gap:
                best, best_gap = into, gap
        if best is None:
            continue
        used.update({out.id, best.id})
        found.append(TransferSuggestion(
            transaction_ids=[out.id, best.id],
            reason="pair",
            detail=(
                f"The same amount left {_name(accounts, out.account_id)} and arrived in "
                f"{_name(accounts, best.account_id)} {_days(best_gap)}."
            ),
            amount=amount,
            on=min(out.transaction_date, best.transaction_date),
            from_account_id=out.account_id,
            to_account_id=best.account_id,
            descriptions=[out.description or "", best.description or ""],
        ))

    tracks_cash = any(a.type == "cash" for a in accounts.values())
    for row in rows:
        if row.id in used:
            continue
        account = accounts.get(row.account_id)
        detailed = (row.personal_finance_category_detailed or "").upper()
        amount = abs(Decimal(str(row.amount)))
        if account is not None and account.type == "credit_card" and row.amount > 0:
            found.append(TransferSuggestion(
                transaction_ids=[row.id], reason="card-payment",
                detail=f"A payment into {account.name}. The purchases it paid for are already counted as spending.",
                amount=amount, on=row.transaction_date, to_account_id=row.account_id,
                descriptions=[row.description or ""],
            ))
        elif detailed in BANK_TRANSFER_CATEGORIES or (detailed == CASH_WITHDRAWAL and tracks_cash and row.amount < 0):
            detail = BANK_TRANSFER_CATEGORIES.get(detailed, "Your bank marks this as a cash withdrawal.")
            found.append(TransferSuggestion(
                transaction_ids=[row.id], reason="bank-category", detail=detail,
                amount=amount, on=row.transaction_date,
                from_account_id=row.account_id if row.amount < 0 else None,
                to_account_id=row.account_id if row.amount > 0 else None,
                descriptions=[row.description or ""],
            ))
        else:
            continue
        used.add(row.id)

    found.sort(key=lambda s: (s.on, s.reason == "pair"), reverse=True)
    return found[:MAX_SUGGESTIONS]


def transfer_category(db: Session, user_id: int) -> Category:
    """The user's Transfer category, created if they have none."""
    rows = (
        db.query(Category)
        .filter(Category.user_id == user_id, Category.type == "transfer")
        .order_by(Category.is_system.desc(), Category.id)
        .all()
    )
    for row in rows:
        if row.name.lower() == "transfer":
            return row
    if rows:
        return rows[0]
    row = Category(user_id=user_id, name="Transfer", type="transfer", color="#7880a0", is_system=True)
    db.add(row)
    db.flush()
    return row
