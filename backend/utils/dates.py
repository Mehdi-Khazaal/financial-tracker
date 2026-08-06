"""The one date rule for the whole backend.

The API process runs in UTC. Two different questions get asked about time and
they have two different correct answers, so mixing them up is how `process-due`
and the assistant ended up disagreeing about what day it was:

  **User-local date** — anything the user reads as a calendar day, or any
  decision that should flip at *their* midnight. "Is this bill due today?",
  "how much did I spend this month?", "what is today's date?". Use
  `user_today(user)`. Resolved through the user's stored IANA timezone,
  falling back to UTC when they have none or it is unrecognised.

  **Server/UTC instant** — anything that records when a row was written or
  when machinery should next run: `created_at`, `updated_at`, job `run_at`,
  idempotency `expires_at`, webhook freshness windows. Use
  `models.database.utc_now`. These are timestamps, not calendar days, and must
  not shift with whoever happens to be looking at them.

Rule of thumb: if a *user* would notice the answer changing at midnight, it is
`user_today`. If only the system cares, it is `utc_now`.

Deliberately not a `date.today()` wrapper — that call reads the server's local
zone, which is UTC in production but the developer's zone locally, so it
produces results that cannot be reproduced across machines. `date.today()`
should not appear in request-handling code.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional
from zoneinfo import ZoneInfo, available_timezones

_VALID_ZONES = available_timezones()
_UTC = ZoneInfo("UTC")


def clean_timezone(value) -> Optional[str]:
    """Accept only a real IANA zone name; anything else is ignored, not fatal.

    A user can carry a stale or hand-edited zone string. Rejecting it quietly
    and falling back to UTC is right: a wrong-by-hours date beats a 500.
    """
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    return candidate if candidate in _VALID_ZONES else None


def user_zone(user) -> ZoneInfo:
    """The user's timezone, or UTC when they have none set or it is invalid."""
    zone_name = clean_timezone(getattr(user, "timezone", None))
    return ZoneInfo(zone_name) if zone_name else _UTC


def user_now(user) -> datetime:
    """Timezone-aware 'now' in the user's own zone."""
    return datetime.now(user_zone(user))


def user_today(user) -> date:
    """The calendar date it currently is *for this user*.

    Every user-facing "is it due / has it happened yet" comparison resolves
    here so the assistant, the recurring scheduler and the dashboard cannot
    disagree about what day it is.
    """
    return user_now(user).date()
