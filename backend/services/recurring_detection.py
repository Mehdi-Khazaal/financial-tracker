"""Finding recurring bills, subscriptions and paychecks in transaction history.

What this replaces: detection used to run in the browser and was built only
for fixed-price subscriptions. It required three charges whose amounts sat
within 15% of each other on a weekly-to-quarterly cycle, so the bills people
most want tracked — electricity, water, a phone plan with overage — could
never qualify, a yearly renewal never could either, and nothing it found could
be acted on.

How a group of charges earns a suggestion
─────────────────────────────────────────
Charges are grouped by merchant identity (`identity_of`). A group becomes a
suggestion only when **all** of the following hold:

1. **Cadence.** The median gap between charges falls in a known cycle —
   weekly, biweekly, monthly, quarterly or yearly — and at least three in four
   gaps agree with it. A shop you happen to visit about monthly fails here.
2. **Enough history.** Weekly 4, biweekly 3, monthly 3, quarterly 3, yearly 2.
   A *bill-like* charge (see below) needs one fewer, never fewer than two, so a
   new phone plan appears after its second bill rather than its third.
3. **Amount.** Within 20% of the median is a fixed charge. A wider swing — up
   to one charge being three times another — is accepted **only** for
   bill-like charges, and marks the result as variable. Variable spend at an
   ordinary merchant is not a bill.
4. **Not in store.** An in-store purchase is not a bill unless it is
   bill-like. Subscriptions are charged online or by direct debit.
5. **Still active.** The last charge is recent enough for the cycle; a lapsed
   subscription is not suggested.

*Bill-like* means Plaid's category or transaction code says so (rent,
utilities, insurance, loan payment, direct debit, bill payment), or the charge
classifies into a group other than "other". Healthcare is bill-like only at a
steady amount: a monthly aligner or treatment plan is a bill even when the
office charges a card on file in person, but varying pharmacy runs are not.

Card payments and transfers between the user's own accounts are never bills:
they move money that was already counted when it was spent.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from statistics import median
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from models.database import Account, Category, RecurringDismissal, RecurringTransaction, Transaction
from services import merchants, recurring_groups
from services.recurring_schedule import next_occurrence

# (period, cycle length in days, accepted median-gap range, minimum charges)
CADENCES: list[tuple[str, float, tuple[int, int], int]] = [
    ("weekly", 7.0, (5, 9), 4),
    ("biweekly", 14.0, (12, 17), 3),
    ("monthly", 30.44, (25, 36), 3),
    ("quarterly", 91.31, (80, 100), 3),
    ("yearly", 365.25, (345, 385), 2),
]
CYCLE_DAYS: dict[str, float] = {period: days for period, days, _, _ in CADENCES}

# How far back detection reads. Two yearly charges need a little over a year.
HISTORY_DAYS = 800

FIXED_SPREAD = Decimal("0.20")
VARIABLE_MAX_RATIO = Decimal("3")
INCOME_SPREAD = Decimal("0.35")

_BILL_CODES = {"direct debit", "bill payment", "standing order"}
_BILL_PFC_PRIMARY = {"RENT_AND_UTILITIES", "LOAN_PAYMENTS"}
_BILL_PFC_DETAILED = {"GENERAL_SERVICES_INSURANCE"}
_NEVER_BILLS_PFC_PRIMARY = {"TRANSFER_IN", "TRANSFER_OUT", "BANK_FEES"}
_NEVER_BILLS_PFC_DETAILED = {"LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"}

_PERIOD_LABEL = {
    "weekly": "every week",
    "biweekly": "every two weeks",
    "monthly": "every month",
    "quarterly": "every three months",
    "yearly": "every year",
}


def identity_of(entity_id: Optional[str], key: Optional[str]) -> Optional[str]:
    """The grouping identity. Plaid's entity id wins; the merchant key is the
    fallback. Prefixed so the two namespaces can never collide."""
    if entity_id:
        return f"entity:{entity_id}"
    if key:
        return f"key:{key}"
    return None


def transaction_key(tx: Transaction) -> str:
    """A transaction's merchant key, derived for rows written before keys were
    stored (and for rows the recurring scheduler created directly)."""
    return tx.merchant_key or merchants.merchant_key(tx.description)


def category_twin(rec: RecurringTransaction, tx: Transaction) -> bool:
    """Whether a charge is plainly this bill even though the names differ.

    People name bills by what they are ("Rent"); banks name them by who is paid
    ("Landlord", "ZELLE TO J SMITH"). A fixed bill and a charge on the same
    account, filed under the same category, within 3% of the same amount, are
    the same bill. Deliberately narrow: all three must agree, and it never
    applies to variable bills, whose amounts are expected to wander.
    """
    if rec.is_variable or rec.category_id is None or tx.category_id != rec.category_id:
        return False
    if tx.account_id != rec.account_id:
        return False
    expected = abs(Decimal(str(rec.amount)))
    actual = abs(Decimal(str(tx.amount)))
    if expected == 0 or (Decimal(str(rec.amount)) < 0) != (Decimal(str(tx.amount)) < 0):
        return False
    return abs(actual - expected) <= expected * Decimal("0.03")


def recurring_keys(rec: RecurringTransaction) -> set[str]:
    """Every merchant key a tracked bill answers to."""
    keys = {rec.merchant_key or "", merchants.merchant_key(rec.description)}
    keys.discard("")
    return keys


@dataclass
class Suggestion:
    identity: str
    name: str
    amount: Decimal  # signed, like a transaction: negative is money out
    period: str
    next_date: date
    last_date: date
    is_variable: bool
    group_key: str
    account_id: int
    category_id: Optional[int]
    occurrences: int
    confidence: str  # "high" | "medium"
    reasons: list[str]
    min_amount: Decimal
    max_amount: Decimal
    plaid_merchant_entity_id: Optional[str]
    merchant_key: Optional[str]
    last_transaction_id: int
    is_income: bool = False
    transaction_ids: list[int] = field(default_factory=list)


def _cadence_for(gaps: list[int]) -> Optional[tuple[str, float, tuple[int, int], int]]:
    if not gaps:
        return None
    mid = median(gaps)
    for cadence in CADENCES:
        low, high = cadence[2]
        if low <= mid <= high:
            agreeing = sum(1 for g in gaps if low <= g <= high)
            needed = len(gaps) if len(gaps) <= 2 else len(gaps) * 0.75
            return cadence if agreeing >= needed else None
    return None


def _money(value: Decimal) -> str:
    return f"${value:,.2f}"


def _is_card_payment(tx: Transaction, account_types: dict[int, str]) -> bool:
    return tx.amount > 0 and account_types.get(tx.account_id) == "credit_card"


def detect(
    db: Session,
    user_id: int,
    today: date,
    *,
    include_tracked: bool = False,
) -> list[Suggestion]:
    """Recurring streams in this user's history, strongest first.

    Excludes anything already tracked and anything the user dismissed, unless
    `include_tracked` is set (used when confirming, to re-find a suggestion the
    client named).
    """
    accounts = db.query(Account).filter(Account.user_id == user_id).all()
    account_types = {a.id: a.type for a in accounts}
    category_names = {
        c.id: c.name
        for c in db.query(Category).filter((Category.user_id == user_id) | (Category.user_id.is_(None))).all()
    }

    rows: Iterable[Transaction] = (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user_id,
            Transaction.transaction_date >= today - timedelta(days=HISTORY_DAYS),
            Transaction.transaction_date <= today,
        )
        .order_by(Transaction.transaction_date)
        .all()
    )

    groups: dict[tuple[str, bool], list[Transaction]] = {}
    for tx in rows:
        if tx.amount == 0 or _is_card_payment(tx, account_types):
            continue
        if (tx.personal_finance_category_primary or "").upper() in _NEVER_BILLS_PFC_PRIMARY:
            continue
        if (tx.personal_finance_category_detailed or "").upper() in _NEVER_BILLS_PFC_DETAILED:
            continue
        identity = identity_of(tx.plaid_merchant_entity_id, transaction_key(tx))
        if not identity:
            continue
        groups.setdefault((identity, tx.amount > 0), []).append(tx)

    tracked_entities: set[str] = set()
    tracked_keys: set[str] = set()
    tracked_rows: list[RecurringTransaction] = []
    dismissed: set[str] = set()
    if not include_tracked:
        tracked_rows = db.query(RecurringTransaction).filter(RecurringTransaction.user_id == user_id).all()
        for rec in tracked_rows:
            if rec.plaid_merchant_entity_id:
                tracked_entities.add(rec.plaid_merchant_entity_id)
            tracked_keys.update(recurring_keys(rec))
        dismissed = {
            d.identity for d in db.query(RecurringDismissal).filter(RecurringDismissal.user_id == user_id).all()
        }

    found: list[Suggestion] = []
    for (identity, is_income), charges in groups.items():
        if identity in dismissed:
            continue
        if any(c.plaid_merchant_entity_id in tracked_entities for c in charges if c.plaid_merchant_entity_id):
            continue
        if any(transaction_key(c) in tracked_keys for c in charges):
            continue
        # Tracked under a different name — "Rent" against the bank's "Landlord".
        if any(category_twin(rec, charges[-1]) for rec in tracked_rows):
            continue
        suggestion = _evaluate(identity, is_income, charges, today, category_names)
        if suggestion:
            found.append(suggestion)

    found.sort(key=lambda s: (s.confidence != "high", s.is_income, -abs(s.amount) * Decimal(str(30.44 / CYCLE_DAYS[s.period]))))
    return found


def _evaluate(
    identity: str,
    is_income: bool,
    charges: list[Transaction],
    today: date,
    category_names: dict[int, str],
) -> Optional[Suggestion]:
    if len(charges) < 2:
        return None

    dates = [c.authorized_date or c.transaction_date for c in charges]
    order = sorted(range(len(charges)), key=lambda i: (dates[i], charges[i].id))
    charges = [charges[i] for i in order]
    dates = [dates[i] for i in order]

    gaps = [(b - a).days for a, b in zip(dates, dates[1:])]
    cadence = _cadence_for(gaps)
    if cadence is None:
        return None
    period, cycle_days, _, min_count = cadence

    latest = charges[-1]
    key = transaction_key(latest)
    category_id = next((c.category_id for c in reversed(charges) if c.category_id is not None), None)
    pfc_primary = (latest.personal_finance_category_primary or "").upper() or None
    pfc_detailed = (latest.personal_finance_category_detailed or "").upper() or None
    code = (latest.transaction_code or "").lower()
    channel = (latest.payment_channel or "").lower()

    # Judge the amount on the recent cycles only — a price rise two years ago
    # should not make today's subscription look variable.
    recent = charges[-6:]
    amounts = [abs(c.amount) for c in recent]
    mid = Decimal(str(median(amounts)))
    if mid <= 0:
        return None
    spread = max(abs(a - mid) for a in amounts) / mid
    ratio = max(amounts) / min(amounts)

    group_key = recurring_groups.classify(
        amount_is_income=is_income,
        pfc_detailed=pfc_detailed,
        pfc_primary=pfc_primary,
        category_name=category_names.get(category_id) if category_id else None,
        merchant_key=key,
        fixed_amount=spread <= FIXED_SPREAD,
        online=channel == "online",
    )
    bill_like = (
        code in _BILL_CODES
        or pfc_primary in _BILL_PFC_PRIMARY
        or pfc_detailed in _BILL_PFC_DETAILED
        or group_key not in {"other", "income", "healthcare"}
        or (group_key == "healthcare" and spread <= FIXED_SPREAD)
    )

    required = min_count if is_income else max(2, min_count - 1) if bill_like else min_count
    if len(charges) < required:
        return None

    if is_income:
        if spread > INCOME_SPREAD:
            return None
        is_variable = spread > Decimal("0.05")
    elif spread <= FIXED_SPREAD:
        is_variable = False
    elif bill_like and ratio <= VARIABLE_MAX_RATIO:
        is_variable = True
    else:
        return None

    if not is_income and channel == "in store" and not bill_like:
        return None

    # Lapsed: the next charge is well overdue.
    if (today - dates[-1]).days > cycle_days * 1.6 + 5:
        return None

    next_date = next_occurrence(latest.transaction_date, period)
    amount_abs = Decimal(str(median([abs(c.amount) for c in charges[-3:]]))) if is_variable else abs(latest.amount)
    amount = amount_abs if is_income else -amount_abs

    reasons = [f"{len(charges)} {'deposits' if is_income else 'charges'}", _PERIOD_LABEL[period]]
    if is_variable:
        reasons.append(f"varies {_money(min(amounts))}–{_money(max(amounts))}")
    else:
        reasons.append("same amount each time" if spread <= Decimal("0.02") else f"about {_money(mid)}")
    if code in _BILL_CODES:
        reasons.append(code)
    elif channel == "online" and not is_income:
        reasons.append("paid online")

    strong = code in _BILL_CODES or pfc_primary in _BILL_PFC_PRIMARY or pfc_detailed in _BILL_PFC_DETAILED
    confidence = "high" if strong or (len(charges) >= required + 2 and not is_variable) else "medium"

    name = latest.plaid_merchant_name or merchants.display_name(latest.description or key) or "Recurring charge"

    return Suggestion(
        identity=identity,
        name=name[:120],
        amount=amount,
        period=period,
        next_date=next_date,
        last_date=latest.transaction_date,
        is_variable=is_variable,
        group_key=group_key,
        account_id=latest.account_id,
        category_id=category_id,
        occurrences=len(charges),
        confidence=confidence,
        reasons=reasons,
        min_amount=min(amounts),
        max_amount=max(amounts),
        plaid_merchant_entity_id=latest.plaid_merchant_entity_id,
        merchant_key=key or None,
        last_transaction_id=latest.id,
        is_income=is_income,
        transaction_ids=[c.id for c in charges],
    )
