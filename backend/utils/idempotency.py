"""Idempotency-Key middleware.

Clients send `Idempotency-Key: <uuid>` on every write. The first request runs
normally and its response is cached; every repeat with the same key + body
replays the cached response instead of running the endpoint again. Different
body under the same key returns 409 so a client bug is loud rather than
silent.

Scoped per user so keys can never collide across tenants. TTL is 24h — long
enough to cover any realistic retry window (offline queue draining, background
sync) but short enough that the table stays bounded.

The middleware itself is async, but its database work is not: the lookup and
the store run in the threadpool. Blocking the event loop on a pooled
connection would stall every other request in flight, including the ones
whose teardown would have freed that connection.
"""

from __future__ import annotations

import hashlib
import json
from datetime import timedelta
from typing import Optional

import jwt
from fastapi import Request
from starlette.concurrency import run_in_threadpool
from sqlalchemy.exc import IntegrityError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from models.database import IdempotencyKey, SessionLocal, utc_now
from utils.auth import ALGORITHM, SECRET_KEY, _get_request_token
from utils.logging import get_logger, kv


logger = get_logger(__name__)


_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_MAX_BODY_BYTES = 512 * 1024  # 512 KB — writes larger than this bypass idempotency.
_TTL = timedelta(hours=24)


def _hash_request(method: str, path: str, body: bytes) -> str:
    h = hashlib.sha256()
    h.update(method.encode("utf-8"))
    h.update(b"\x00")
    h.update(path.encode("utf-8"))
    h.update(b"\x00")
    h.update(body)
    return h.hexdigest()


def _user_id_from_request(request: Request) -> Optional[int]:
    token = _get_request_token(request)
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "access":
            return None
        return int(payload["sub"])
    except (jwt.InvalidTokenError, ValueError, KeyError):
        return None


class IdempotencyMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, session_factory=None):
        super().__init__(app)
        self._session_factory = session_factory or SessionLocal

    async def dispatch(self, request: Request, call_next):
        if request.method not in _WRITE_METHODS:
            return await call_next(request)

        key = request.headers.get("Idempotency-Key")
        if not key:
            return await call_next(request)
        key = key.strip()
        if not key or len(key) > 80:
            return await call_next(request)

        user_id = _user_id_from_request(request)
        if user_id is None:
            # Auth failure will be handled by the endpoint. Skip caching so we
            # don't associate a key with a null user.
            return await call_next(request)

        body_bytes = await request.body()
        if len(body_bytes) > _MAX_BODY_BYTES:
            return await call_next(request)
        # Starlette consumed the body — reinject it so the endpoint can read it.
        async def _receive() -> dict:
            return {"type": "http.request", "body": body_bytes, "more_body": False}
        request._receive = _receive  # type: ignore[attr-defined]

        req_hash = _hash_request(request.method, request.url.path, body_bytes)

        cached = await run_in_threadpool(self._lookup, user_id, key, req_hash, request.url.path)
        if cached is not None:
            return cached

        response = await call_next(request)

        # Only cache success-y JSON responses. Errors should be retryable.
        if not (200 <= response.status_code < 300):
            return response

        response_body_chunks: list[bytes] = []
        async for chunk in response.body_iterator:
            response_body_chunks.append(chunk)
        response_body = b"".join(response_body_chunks)

        media_type = response.media_type or response.headers.get("content-type", "")
        if response_body and "json" in media_type:
            await run_in_threadpool(
                self._store, user_id, key, request.method, request.url.path,
                req_hash, response.status_code, response_body,
            )

        return Response(
            content=response_body,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.media_type,
        )

    def _lookup(self, user_id: int, key: str, req_hash: str, path: str) -> Optional[Response]:
        """The response to send instead of running the endpoint, or None to run it."""
        db = self._session_factory()
        try:
            existing = (
                db.query(IdempotencyKey)
                .filter(IdempotencyKey.user_id == user_id, IdempotencyKey.key == key)
                .one_or_none()
            )
            if existing is None:
                return None
            if existing.expires_at <= utc_now():
                db.delete(existing)
                db.commit()
                return None
            if existing.request_hash != req_hash:
                return Response(
                    content=json.dumps({"detail": "Idempotency-Key reused with a different payload"}),
                    status_code=409,
                    media_type="application/json",
                )
            logger.info("idempotency_replay %s", kv(user_id=user_id, path=path))
            return Response(
                content=existing.response_body,
                status_code=existing.response_status,
                media_type="application/json",
            )
        finally:
            db.close()

    def _store(
        self, user_id: int, key: str, method: str, path: str,
        req_hash: str, status_code: int, response_body: bytes,
    ) -> None:
        db = self._session_factory()
        try:
            db.add(IdempotencyKey(
                user_id=user_id,
                key=key,
                method=method,
                path=path,
                request_hash=req_hash,
                response_status=status_code,
                response_body=response_body.decode("utf-8", errors="replace"),
                expires_at=utc_now() + _TTL,
            ))
            db.commit()
        except IntegrityError:
            # Another concurrent request stored the same key first — safe
            # to ignore; the next replay will pick up their row.
            db.rollback()
        except Exception as exc:
            logger.warning("idempotency_store_failed %s", kv(error=str(exc)))
            db.rollback()
        finally:
            db.close()
