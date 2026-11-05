"""Collections: group transactions (a trip, a holiday, a move) and add up what it cost.

A collection never changes a transaction. Totals use the same rules as the
Analytics screen (`frontend/src/features/analytics/calculations/transactions.ts`):

* a negative amount is spending, unless it is filed under an investment
  category (buying gold is not spending);
* a positive amount under an expense category is a refund and comes off the
  cost;
* a positive amount on a credit card is a card payment and is not counted
  (the purchases already were);
* any other positive amount is money received (a friend paying you back) and
  comes off the cost too.

So `net = spent - returned`. If you change a rule here, change it there too.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from models.database import Account, Category, Collection, CollectionTransaction, RecurringTransaction, Transaction, utc_now
from services.merchants import merchant_key

ZERO = Decimal("0")
MAX_SUGGESTIONS = 300


class CollectionNotFound(Exception):
    pass


class TransactionNotFound(Exception):
    pass


class CardPaymentNotAllowed(Exception):
    pass


# ─── Classification ───────────────────────────────────────────────────────────
@dataclass
class Lookups:
    account_types: dict[int, str]
    category_types: dict[int, str]


def load_lookups(db: Session, user_id: int) -> Lookups:
    accounts = dict(db.query(Account.id, Account.type).filter(Account.user_id == user_id).all())
    categories = dict(db.query(Category.id, Category.type).filter((Category.user_id == user_id) | (Category.user_id.is_(None))).all())
    return Lookups(accounts, categories)


def classify_values(amount, category_id: Optional[int], account_id: Optional[int], lookups: Lookups) -> str:
    amount = Decimal(str(amount or 0))
    if amount == 0:
        return "excluded"
    category_type = lookups.category_types.get(category_id) if category_id is not None else None
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


# ─── Totals ───────────────────────────────────────────────────────────────────
@dataclass
class Totals:
    spent: Decimal = ZERO
    returned: Decimal = ZERO
    count: int = 0
    first_date: Optional[date] = None
    last_date: Optional[date] = None

    @property
    def net(self) -> Decimal:
        return self.spent - self.returned

    def add(self, tx: Transaction, kind: str) -> None:
        amount = abs(Decimal(str(tx.amount or 0)))
        if kind == "expense":
            self.spent += amount
        elif kind in ("refund", "income"):
            self.returned += amount
        self.count += 1
        day = tx.transaction_date
        if day is not None:
            self.first_date = day if self.first_date is None else min(self.first_date, day)
            self.last_date = day if self.last_date is None else max(self.last_date, day)


def totals_by_collection(db: Session, user_id: int, lookups: Optional[Lookups] = None) -> dict[int, Totals]:
    lookups = lookups or load_lookups(db, user_id)
    rows = (
        db.query(CollectionTransaction.collection_id, Transaction)
        .join(Transaction, Transaction.id == CollectionTransaction.transaction_id)
        .filter(CollectionTransaction.user_id == user_id, Transaction.user_id == user_id)
        .all()
    )
    out: dict[int, Totals] = {}
    for collection_id, tx in rows:
        out.setdefault(collection_id, Totals()).add(tx, classify(tx, lookups))
    return out


def category_breakdown(db: Session, user_id: int, collection_id: int, lookups: Optional[Lookups] = None) -> list[tuple[Optional[int], Decimal]]:
    """Net spending per category inside one collection, biggest first.
    Split transactions count per line; refunds come off their category."""
    lookups = lookups or load_lookups(db, user_id)
    transactions = (
        db.query(Transaction)
        .join(CollectionTransaction, CollectionTransaction.transaction_id == Transaction.id)
        .filter(CollectionTransaction.collection_id == collection_id, CollectionTransaction.user_id == user_id, Transaction.user_id == user_id)
        .all()
    )
    sums: dict[Optional[int], Decimal] = {}
    for tx in transactions:
        lines = [(line.category_id, line.amount) for line in tx.splits] if tx.splits else [(tx.category_id, tx.amount)]
        for category_id, amount in lines:
            kind = classify_values(amount, category_id, tx.account_id, lookups)
            if kind == "expense":
                sums[category_id] = sums.get(category_id, ZERO) + abs(Decimal(str(amount)))
            elif kind == "refund":
                sums[category_id] = sums.get(category_id, ZERO) - abs(Decimal(str(amount)))
    return sorted(((cid, total) for cid, total in sums.items() if total != 0), key=lambda item: item[1], reverse=True)


def is_active(collection: Collection, today: date) -> bool:
    """Running right now: has started, has not ended, not archived."""
    if collection.is_archived or collection.start_date is None:
        return False
    if collection.start_date > today:
        return False
    return collection.end_date is None or today <= collection.end_date


# ─── Ownership ────────────────────────────────────────────────────────────────
def owned_collection(db: Session, user_id: int, collection_id: int) -> Collection:
    row = db.query(Collection).filter(Collection.id == collection_id, Collection.user_id == user_id).first()
    if row is None:
        raise CollectionNotFound()
    return row


def owned_collections(db: Session, user_id: int, collection_ids: Iterable[int]) -> list[Collection]:
    wanted = set(collection_ids)
    if not wanted:
        return []
    rows = db.query(Collection).filter(Collection.user_id == user_id, Collection.id.in_(wanted)).all()
    if {row.id for row in rows} != wanted:
        raise CollectionNotFound()
    return rows


def _owned_transactions(db: Session, user_id: int, transaction_ids: set[int]) -> list[Transaction]:
    rows = db.query(Transaction).filter(Transaction.user_id == user_id, Transaction.id.in_(transaction_ids)).all()
    if {row.id for row in rows} != transaction_ids:
        raise TransactionNotFound()
    return rows


# ─── Membership ───────────────────────────────────────────────────────────────
@dataclass
class AddResult:
    added: int = 0
    already: int = 0
    skipped_card_payments: int = 0


def add_transactions(db: Session, user_id: int, collection: Collection, transaction_ids: Iterable[int]) -> AddResult:
    """Put transactions in the collection. Already-there ones are left alone,
    card payments are skipped (they are not spending). Does not commit."""
    ids = set(transaction_ids)
    result = AddResult()
    if not ids:
        return result
    transactions = _owned_transactions(db, user_id, ids)
    lookups = load_lookups(db, user_id)
    existing = {
        tid for (tid,) in db.query(CollectionTransaction.transaction_id).filter(
            CollectionTransaction.collection_id == collection.id,
            CollectionTransaction.transaction_id.in_(ids),
        )
    }
    for tx in sorted(transactions, key=lambda t: t.id):
        if tx.id in existing:
            result.already += 1
        elif classify(tx, lookups) == "card-payment":
            result.skipped_card_payments += 1
        else:
            db.add(CollectionTransaction(collection_id=collection.id, transaction_id=tx.id, user_id=user_id))
            result.added += 1
    if result.added:
        collection.updated_at = utc_now()
    return result


def remove_transactions(db: Session, user_id: int, collection: Collection, transaction_ids: Iterable[int]) -> int:
    """Take transactions out of the collection. The transactions stay. Does not commit."""
    ids = set(transaction_ids)
    if not ids:
        return 0
    removed = (
        db.query(CollectionTransaction)
        .filter(
            CollectionTransaction.user_id == user_id,
            CollectionTransaction.collection_id == collection.id,
            CollectionTransaction.transaction_id.in_(ids),
        )
        .delete(synchronize_session=False)
    )
    if removed:
        collection.updated_at = utc_now()
    return removed


def set_for_transaction(db: Session, user_id: int, tx: Transaction, collection_ids: Iterable[int]) -> None:
    """Make the transaction's collections exactly `collection_ids`. Does not commit."""
    wanted = set(collection_ids)
    collections = owned_collections(db, user_id, wanted)
    if wanted and classify(tx, load_lookups(db, user_id)) == "card-payment":
        raise CardPaymentNotAllowed()
    current = {link.collection_id: link for link in tx.collection_links}
    for collection_id, link in current.items():
        if collection_id not in wanted:
            tx.collection_links.remove(link)
            db.delete(link)
    now = utc_now()
    for collection in collections:
        if collection.id not in current:
            tx.collection_links.append(CollectionTransaction(collection_id=collection.id, transaction_id=tx.id, user_id=user_id))
        collection.updated_at = now


# ─── Suggestions ──────────────────────────────────────────────────────────────
@dataclass
class Suggestion:
    transaction: Transaction
    recommended: bool
    reason: Optional[str] = None


@dataclass
class _BillIdentities:
    entity_ids: set[str] = field(default_factory=set)
    keys: set[str] = field(default_factory=set)

    def matches(self, tx: Transaction) -> bool:
        if tx.plaid_merchant_entity_id and tx.plaid_merchant_entity_id in self.entity_ids:
            return True
        key = tx.merchant_key or merchant_key(tx.description)
        return bool(key) and key in self.keys


def _bill_identities(db: Session, user_id: int) -> _BillIdentities:
    found = _BillIdentities()
    bills = db.query(RecurringTransaction).filter(RecurringTransaction.user_id == user_id, RecurringTransaction.is_active.is_(True)).all()
    for bill in bills:
        if bill.plaid_merchant_entity_id:
            found.entity_ids.add(bill.plaid_merchant_entity_id)
        for key in (bill.merchant_key, merchant_key(bill.description)):
            if key:
                found.keys.add(key)
    return found


REASONS = {
    "investment": "Investment",
    "income": "Money in",
}


def suggestions(db: Session, user_id: int, collection: Collection, today: date, include_reviewed: bool = False) -> list[Suggestion]:
    """Transactions in the collection's dates that are not in it yet.

    Only dated collections get suggestions. After the user has reviewed them,
    only transactions that arrived since come back, unless `include_reviewed`.
    Each one says whether it looks like part of the trip: regular bills,
    investments and money coming in start unchecked. Card payments are left
    out, since they can't be added.
    """
    if collection.start_date is None:
        return []
    end = collection.end_date or today
    if end < collection.start_date:
        return []
    already = db.query(CollectionTransaction.transaction_id).filter(CollectionTransaction.collection_id == collection.id)
    query = db.query(Transaction).filter(
        Transaction.user_id == user_id,
        Transaction.transaction_date >= collection.start_date,
        Transaction.transaction_date <= end,
        ~Transaction.id.in_(already),
    )
    if collection.suggestions_reviewed_at is not None and not include_reviewed:
        query = query.filter(Transaction.created_at > collection.suggestions_reviewed_at)
    rows = query.order_by(Transaction.transaction_date.desc(), Transaction.id.desc()).limit(MAX_SUGGESTIONS).all()
    if not rows:
        return []
    lookups = load_lookups(db, user_id)
    bills = _bill_identities(db, user_id)
    out: list[Suggestion] = []
    for tx in rows:
        kind = classify(tx, lookups)
        if kind in ("excluded", "card-payment"):
            continue
        if kind in REASONS:
            out.append(Suggestion(tx, False, REASONS[kind]))
        elif bills.matches(tx):
            out.append(Suggestion(tx, False, "Regular bill"))
        else:
            out.append(Suggestion(tx, True))
    return out


def mark_reviewed(collection: Collection, when: Optional[datetime] = None) -> None:
    collection.suggestions_reviewed_at = when or utc_now()
