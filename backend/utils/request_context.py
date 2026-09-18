"""Per-request id and access log.

Every request gets an id — the caller's `X-Request-ID` when it is a sane
token, otherwise a fresh one — that is echoed back in the response, attached
to every log line written while the request runs (see `utils.logging`), and
carried into background tasks the request starts. One `http_request` line is
logged per request with method, path, status and duration; health probes log
at DEBUG so a platform pinging every few seconds does not drown everything
else.
"""

from __future__ import annotations

import re
import time
import uuid

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from utils.logging import get_logger, kv, request_id_var

logger = get_logger(__name__)

_SAFE_ID = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
_QUIET_PATHS = {"/healthz", "/readyz"}


def incoming_request_id(header_value: str | None) -> str:
    candidate = (header_value or "").strip()
    if candidate and _SAFE_ID.match(candidate):
        return candidate
    return uuid.uuid4().hex


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = incoming_request_id(request.headers.get("x-request-id"))
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers["X-Request-ID"] = request_id
            return response
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 1)
            level = logger.debug if request.url.path in _QUIET_PATHS else logger.info
            level(
                "http_request %s",
                kv(method=request.method, path=request.url.path, status=status, duration_ms=duration_ms),
            )
            request_id_var.reset(token)
