"""Recurring cadence arithmetic — the one implementation.

`period` is validated at the schema boundary (`models.schemas.RecurringPeriod`),
but validation at the edge is not enough on its own: rows predating that
validation, direct DB writes, and future code paths can all present a period
this module has never heard of. So every function here fails loudly on an
unknown value rather than guessing.

That strictness is the actual bug fix. `_next_date` used to end with
`return current` for anything unrecognised, so a recurring row with a bad
period never advanced its `next_date` — and `process-due`, which materializes
every row whose `next_date <= today`, re-created that transaction and
re-adjusted the account balance on every single run. A malformed period was
therefore an unbounded duplicate-transaction and balance-drift bug. Raising
turns that silent corruption into a 4xx the caller can see.
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta
from typing import Final

# Must stay in step with `models.schemas.RecurringPeriod`. Kept as a plain
# frozenset rather than re-deriving from the Literal so this module has no
# dependency on Pydantic — the job handlers and backfill import it too.
VALID_PERIODS: Final[frozenset[str]] = frozenset(
    {"weekly", "biweekly", "monthly", "quarterly", "yearly"}
)

# How many times each period fires in a year. Used for annualised cost.
# Note there is deliberately no "daily" entry: it is not a period the product
# supports, and the assistant previously carried one in a private lookup table,
# which meant it could annualise a cadence nothing else could schedule.
OCCURRENCES_PER_YEAR: Final[dict[str, int]] = {
    "weekly": 52,
    "biweekly": 26,
    "monthly": 12,
    "quarterly": 4,
    "yearly": 1,
}


class UnsupportedPeriodError(ValueError):
    """Raised when a recurring period is not one this module can schedule."""

    def __init__(self, period: object):
        self.period = period
        super().__init__(
            f"Unsupported recurring period {period!r}. "
            f"Expected one of: {', '.join(sorted(VALID_PERIODS))}."
        )


def ensure_supported(period: object) -> str:
    """Return `period` as a known cadence, or raise `UnsupportedPeriodError`."""
    if not isinstance(period, str) or period not in VALID_PERIODS:
        raise UnsupportedPeriodError(period)
    return period


def _add_months(current: date, months: int) -> date:
    """Advance by whole months, clamping to the last valid day of the target.

    The 31st of a month lands on the 30th (or 28th/29th) where the target month
    is shorter, matching how banks actually schedule a monthly charge.
    """
    zero_based = current.month - 1 + months
    year = current.year + zero_based // 12
    month = zero_based % 12 + 1
    day = min(current.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def next_occurrence(current: date, period: str) -> date:
    """The next firing date after `current`.

    Raises `UnsupportedPeriodError` for an unknown period — never returns
    `current` unchanged, which is what allowed repeated materialization.
    """
    period = ensure_supported(period)
    if period == "weekly":
        return current + timedelta(weeks=1)
    if period == "biweekly":
        return current + timedelta(weeks=2)
    if period == "monthly":
        return _add_months(current, 1)
    if period == "quarterly":
        return _add_months(current, 3)
    if period == "yearly":
        # Feb 29 has no counterpart in a common year; clamp to Feb 28.
        return _add_months(current, 12)
    # Unreachable: `ensure_supported` covers every branch above. Present so a
    # newly added period cannot silently fall through to an implicit None.
    raise UnsupportedPeriodError(period)


def occurrences_per_year(period: str) -> int:
    """How many times this cadence fires per year."""
    return OCCURRENCES_PER_YEAR[ensure_supported(period)]
