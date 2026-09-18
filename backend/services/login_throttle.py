"""Per-identifier login lockout with exponential backoff.

Policy
──────
* Failures are counted per normalised identifier (email or username, lower
  cased) regardless of the caller's address.
* After `LOCKOUT_THRESHOLD` consecutive failures the identifier is locked for
  `BASE_LOCK_SECONDS`; every further failure doubles the lock, capped at
  `MAX_LOCK_SECONDS`. A locked identifier is refused even with the right
  password — that is the point, and the response says when to retry.
* A successful login clears the record. Failures older than `FAILURE_WINDOW`
  are forgotten, so an occasional typo months apart never accumulates.

The row is committed inside `record_failure` so the counter survives the 401
the caller raises straight after. Every function is safe on a session that
is about to be discarded.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Optional

from sqlalchemy.orm import Session

from models.auth import AuthFailure
from models.database import utc_now

LOCKOUT_THRESHOLD = 5
BASE_LOCK_SECONDS = 60
MAX_LOCK_SECONDS = 15 * 60
FAILURE_WINDOW = timedelta(hours=1)


def normalize(identifier: str) -> str:
    return (identifier or "").strip().lower()[:320]


def seconds_locked(db: Session, identifier: str) -> Optional[int]:
    """Seconds until this identifier may try again, or None when it may now."""
    row = db.query(AuthFailure).filter(AuthFailure.identifier == normalize(identifier)).first()
    if row is None or row.locked_until is None:
        return None
    remaining = (row.locked_until - utc_now()).total_seconds()
    if remaining <= 0:
        return None
    return max(1, int(remaining + 0.999))


def record_failure(db: Session, identifier: str) -> None:
    key = normalize(identifier)
    if not key:
        return
    now = utc_now()
    row = db.query(AuthFailure).filter(AuthFailure.identifier == key).first()
    if row is None:
        row = AuthFailure(identifier=key, failures=0)
        db.add(row)
    stale = row.last_failure_at is None or now - row.last_failure_at > FAILURE_WINDOW
    row.failures = 1 if stale else row.failures + 1
    row.last_failure_at = now
    if row.failures >= LOCKOUT_THRESHOLD:
        lock = min(BASE_LOCK_SECONDS * (2 ** (row.failures - LOCKOUT_THRESHOLD)), MAX_LOCK_SECONDS)
        row.locked_until = now + timedelta(seconds=lock)
    db.commit()


def clear(db: Session, identifier: str) -> None:
    key = normalize(identifier)
    if not key:
        return
    db.query(AuthFailure).filter(AuthFailure.identifier == key).delete()
    db.commit()
