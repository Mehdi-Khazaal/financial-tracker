"""Big one-off spending, left out of a usual month.

The goal plan funds goals from what is kept in a month. As a plain average,
that figure absorbed every large purchase: on the live ledger a $7,000
motorcycle, a $3,050 car repair and $10,510 of tuition pulled "you keep" down
to $783 a month, against about $1,935 in a typical month. Tuition was counted
twice over, once as past spending lowering the figure and again as the
Education goal saving for the next semester.

A one-off is spending (by the shared classifier) of at least `ONE_OFF_MIN`
that is not routine. Routine means the same merchant charged a similar amount
(within `SIMILAR_SHARE`) in at least `ROUTINE_OTHER_MONTHS` other months: rent
or a car payment, which is what a month costs. The user's own mark on a
transaction (`Transaction.one_off`) overrides the rule either way.

Mirrored by `features/analytics/calculations/oneOffs.ts`; the two must agree.
"""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Iterable

from models.database import Transaction
from services.classification import Lookups, classify
from services.merchants import merchant_key

ONE_OFF_MIN = Decimal("1000")
SIMILAR_SHARE = Decimal("0.25")
ROUTINE_OTHER_MONTHS = 2


def _key(tx: Transaction) -> str:
    return tx.merchant_key or merchant_key(tx.description or "")


def one_offs(transactions: Iterable[Transaction], lookups: Lookups) -> dict[int, Decimal]:
    """Transaction id to amount spent, for every one-off among `transactions`.

    Routine is judged against the same `transactions`, so pass enough history
    for a monthly charge to show up in other months.
    """
    spending = [
        (tx, abs(Decimal(str(tx.amount))))
        for tx in transactions
        if classify(tx, lookups) == "expense"
    ]
    months_by_merchant: dict[str, list[tuple[str, Decimal]]] = defaultdict(list)
    for tx, amount in spending:
        months_by_merchant[_key(tx)].append((tx.transaction_date.strftime("%Y-%m"), amount))

    found: dict[int, Decimal] = {}
    for tx, amount in spending:
        if tx.one_off is not None:
            if tx.one_off:
                found[tx.id] = amount
            continue
        if amount < ONE_OFF_MIN:
            continue
        month = tx.transaction_date.strftime("%Y-%m")
        similar_months = {
            other_month
            for other_month, other in months_by_merchant[_key(tx)]
            if other_month != month and abs(other - amount) <= amount * SIMILAR_SHARE
        }
        if len(similar_months) < ROUTINE_OTHER_MONTHS:
            found[tx.id] = amount
    return found
