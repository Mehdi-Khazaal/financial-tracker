"""Per-user preferences, and the one rule for reading them.

Two things live here and they are deliberately separate:

* **What the user asked for** — the stored preference, or its default when no
  row exists. This is what `GET /preferences` shows and `PATCH /preferences`
  writes.
* **What actually happens** — the *effective* value, which folds in the global
  `AUTO_CATEGORIZE` environment kill-switch. The switch outranks the user in
  one direction only: it can disable, never enable.

Keeping them apart is what lets the UI say "your setting is on, but Fintrack
has this turned off right now" instead of quietly showing a switch that does
nothing.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Optional

from sqlalchemy.orm import Session

from models.database import UserPreferences
from services.transaction_enrichment import auto_categorize_enabled


# The behaviour a user gets before they have ever changed anything, which is
# also exactly the behaviour that shipped before this table existed. Any new
# preference must default to whatever production already does, or deploying it
# would change behaviour for everyone who never asked.
DEFAULTS: dict[str, Any] = {
    "automatic_categorization_enabled": True,
    "bill_reminders_enabled": True,
    "budget_alerts_enabled": True,
    "low_balance_alerts_enabled": False,
    "low_balance_threshold": Decimal("100.00"),
}

CENTS = Decimal("0.01")

# Memo key for the per-session cache below.
_CACHE_KEY = "fintrack_user_preferences"


def get_row(session: Session, user_id: int) -> Optional[UserPreferences]:
    """The stored row, or None when the user has never changed anything."""
    return (
        session.query(UserPreferences)
        .filter(UserPreferences.user_id == user_id)
        .first()
    )


def stored_values(session: Session, user_id: int) -> dict[str, Any]:
    """What the user has chosen, falling back to the defaults per field.

    Reading field by field rather than returning the row means a preference
    added later is answered correctly for users whose row predates it.
    """
    row = get_row(session, user_id)
    if row is None:
        return dict(DEFAULTS)
    return {
        "automatic_categorization_enabled": bool(row.automatic_categorization_enabled),
        "bill_reminders_enabled": _flag(row.bill_reminders_enabled, DEFAULTS["bill_reminders_enabled"]),
        "budget_alerts_enabled": _flag(row.budget_alerts_enabled, DEFAULTS["budget_alerts_enabled"]),
        "low_balance_alerts_enabled": _flag(row.low_balance_alerts_enabled, DEFAULTS["low_balance_alerts_enabled"]),
        "low_balance_threshold": (
            Decimal(str(row.low_balance_threshold)).quantize(CENTS)
            if row.low_balance_threshold is not None else DEFAULTS["low_balance_threshold"]
        ),
    }


def _flag(value, default: bool) -> bool:
    """A column that may be NULL on a row written before it existed."""
    return default if value is None else bool(value)


def alerts_enabled(session: Session, user_id: int, kind: str) -> bool:
    """Whether one kind of alert may be sent: 'bill', 'budget' or 'low_balance'."""
    values = stored_values(session, user_id)
    return bool(values[{"bill": "bill_reminders_enabled", "budget": "budget_alerts_enabled", "low_balance": "low_balance_alerts_enabled"}[kind]])


def automatic_categorization_enabled(session: Session, user_id: int) -> bool:
    """Whether Fintrack may choose a category for this user, all rules applied.

    `global AND user`. The environment switch is checked first because it needs
    no database at all, which keeps the disabled case free.

    The per-user answer is memoised on `Session.info` — SQLAlchemy's own
    per-session scratch space, so it lives and dies with the session and leaks
    nothing between requests. Without it a Plaid sync would repeat this lookup
    once per imported row; with it, a sync of a thousand transactions asks once.
    A long-running sync therefore uses the value as it was when the sync
    started, which is the behaviour you want anyway: a preference changed
    mid-import should not apply to half of it.
    """
    if not auto_categorize_enabled():
        return False

    cache = session.info.setdefault(_CACHE_KEY, {})
    if user_id in cache:
        return cache[user_id]

    enabled = stored_values(session, user_id)["automatic_categorization_enabled"]
    cache[user_id] = enabled
    return enabled


def forget_cached(session: Session, user_id: int) -> None:
    """Drop the memo for one user.

    Called after a write so a read in the same session sees the new value. The
    cache is an optimisation for the import path, not a source of truth, and it
    must never be the reason a just-saved setting appears not to have saved.
    """
    cache = session.info.get(_CACHE_KEY)
    if cache:
        cache.pop(user_id, None)


def upsert(session: Session, user_id: int, changes: dict[str, Any]) -> UserPreferences:
    """Apply a partial update, creating the row on first use.

    Does not commit — the caller owns the transaction, matching every other
    write in this codebase.
    """
    row = get_row(session, user_id)
    if row is None:
        row = UserPreferences(user_id=user_id, **DEFAULTS)
        session.add(row)

    for field, value in changes.items():
        if field == "low_balance_threshold" and value is not None:
            value = Decimal(str(value)).quantize(CENTS)
        setattr(row, field, value)

    forget_cached(session, user_id)
    return row
