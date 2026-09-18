"""Optional error reporting. Does nothing unless `SENTRY_DSN` is set.

Sentry's SDK auto-instruments FastAPI/Starlette when it is installed, so the
only decision here is whether to turn it on. `send_default_pii` stays off:
request bodies and user identifiers hold financial data and never leave the
service through this path. Tracing is off by default (`SENTRY_TRACES_SAMPLE_RATE`).
"""

from __future__ import annotations

import os

from utils.logging import get_logger, kv

logger = get_logger(__name__)


def sentry_enabled() -> bool:
    return bool(os.getenv("SENTRY_DSN", "").strip())


def init_sentry() -> bool:
    """Initialise the SDK when configured. Returns whether it is active."""
    dsn = os.getenv("SENTRY_DSN", "").strip()
    if not dsn:
        return False
    try:
        import sentry_sdk
    except ImportError:
        logger.warning("sentry_not_installed %s", kv(hint="pip install 'sentry-sdk[fastapi]'"))
        return False
    try:
        rate = float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0") or 0)
    except ValueError:
        rate = 0.0
    sentry_sdk.init(
        dsn=dsn,
        environment=os.getenv("ENVIRONMENT", "development"),
        release=os.getenv("RENDER_GIT_COMMIT") or os.getenv("GIT_COMMIT") or None,
        send_default_pii=False,
        traces_sample_rate=max(0.0, min(rate, 1.0)),
    )
    logger.info("sentry_enabled %s", kv(environment=os.getenv("ENVIRONMENT", "development"), traces=rate))
    return True
