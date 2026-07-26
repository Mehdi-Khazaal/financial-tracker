"""Postgres-backed background job queue.

Handlers register themselves via `register(kind, fn)`. The dispatcher pulls
due `pending` rows, marks them `running` with a lease (`locked_until`), runs
the handler, and transitions to `done` on success or reschedules with
exponential backoff on failure.

Deliberately simple:
- No worker daemon. The cron endpoint drives dispatching, so hosting stays
  serverless-friendly.
- SQLite-safe: we lease with a `locked_until` timestamp check instead of
  `SELECT ... FOR UPDATE SKIP LOCKED` so tests + local dev do not need
  Postgres.
- Failure surfaces via `last_error`; after `MAX_TRIES` the job is `dead`
  and requires manual intervention.
"""

from __future__ import annotations

import json
import traceback
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, Optional

from sqlalchemy.orm import Session

from models.database import Job, utc_now
from utils.logging import get_logger, kv


logger = get_logger(__name__)


MAX_TRIES = 5
LEASE = timedelta(minutes=5)
# Exponential backoff: 30s, 2min, 8min, 32min, 2h.
_BACKOFF_SECONDS = [30, 120, 480, 1920, 7200]

_handlers: Dict[str, Callable[[Session, Dict[str, Any]], Any]] = {}


def register(kind: str, fn: Callable[[Session, Dict[str, Any]], Any]) -> None:
    """Register a handler for `kind`. Overwrites any prior registration."""
    _handlers[kind] = fn


def enqueue(
    session: Session,
    kind: str,
    payload: Optional[Dict[str, Any]] = None,
    *,
    run_at: Optional[datetime] = None,
) -> Job:
    job = Job(
        kind=kind,
        payload=json.dumps(payload or {}),
        run_at=run_at or utc_now(),
        status="pending",
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


def _next_run_at(tries: int) -> datetime:
    idx = min(tries, len(_BACKOFF_SECONDS) - 1)
    return utc_now() + timedelta(seconds=_BACKOFF_SECONDS[idx])


def _lease(session: Session, job: Job) -> bool:
    """Acquire the run lease. Returns False if another worker beat us."""
    now = utc_now()
    updated = (
        session.query(Job)
        .filter(
            Job.id == job.id,
            Job.status == "pending",
            (Job.locked_until.is_(None)) | (Job.locked_until <= now),
        )
        .update(
            {"status": "running", "locked_until": now + LEASE},
            synchronize_session=False,
        )
    )
    session.commit()
    return updated == 1


def dispatch(session: Session, limit: int = 25) -> Dict[str, int]:
    """Run up to `limit` due jobs. Called by the cron endpoint."""
    ran = 0
    succeeded = 0
    failed = 0

    now = utc_now()
    due = (
        session.query(Job)
        .filter(
            Job.status == "pending",
            Job.run_at <= now,
            (Job.locked_until.is_(None)) | (Job.locked_until <= now),
        )
        .order_by(Job.run_at.asc())
        .limit(limit)
        .all()
    )

    for job in due:
        if not _lease(session, job):
            continue
        session.refresh(job)
        ran += 1

        handler = _handlers.get(job.kind)
        if handler is None:
            job.status = "failed"
            job.last_error = f"no handler for kind {job.kind!r}"
            job.tries += 1
            session.commit()
            failed += 1
            logger.warning("job_missing_handler %s", kv(job_id=job.id, kind=job.kind))
            continue

        try:
            payload = json.loads(job.payload or "{}")
            handler(session, payload)
        except Exception as exc:
            session.rollback()
            job.tries += 1
            job.last_error = f"{exc.__class__.__name__}: {exc}\n{traceback.format_exc()[-2000:]}"
            job.locked_until = None
            if job.tries >= MAX_TRIES:
                job.status = "dead"
            else:
                job.status = "pending"
                job.run_at = _next_run_at(job.tries)
            session.commit()
            failed += 1
            logger.warning("job_failed %s", kv(job_id=job.id, kind=job.kind, tries=job.tries))
            continue

        job.status = "done"
        job.locked_until = None
        session.commit()
        succeeded += 1

    return {"ran": ran, "succeeded": succeeded, "failed": failed}
