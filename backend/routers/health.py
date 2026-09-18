"""Liveness and readiness.

`/healthz` answers as soon as the process can serve a request — it is what a
platform pings to decide whether to restart the container, so it must not
depend on anything outside the process. The one exception is decided once at
boot, not per request: a process that found the schema missing columns the
code needs answers 503, because every real request would fail and a platform
that sees a failing health check keeps the previous release live. `/readyz` additionally proves the
database answers a trivial query within a short timeout, which is the signal
for "safe to route traffic here" and the thing a cold Neon pooler is slowest
to give. Neither route is authenticated and neither returns anything about
the deployment beyond up/down.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from models.database import get_db
from utils.migrations import SCHEMA_STATE
from utils.logging import get_logger, kv

router = APIRouter(tags=["health"])
logger = get_logger(__name__)


def _schema_behind() -> bool:
    return bool(SCHEMA_STATE.get("missing"))


@router.get("/healthz")
def healthz():
    if _schema_behind():
        return JSONResponse(status_code=503, content={"status": "unavailable", "schema": "behind"})
    return {"status": "ok"}


@router.get("/readyz")
def readyz(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - exercised via monkeypatch in tests
        logger.warning("readiness_check_failed %s", kv(error_type=type(exc).__name__))
        return JSONResponse(status_code=503, content={"status": "unavailable", "database": "down"})
    if _schema_behind():
        return JSONResponse(status_code=503, content={"status": "unavailable", "database": "up", "schema": "behind"})
    return {"status": "ok", "database": "up"}
