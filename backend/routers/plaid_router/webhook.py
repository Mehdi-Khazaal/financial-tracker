"""Plaid webhook: ES256 JWT verification against Plaid's published keys, then
a background sync for the Item named in the payload."""

import hashlib
import hmac
import json
import time
from collections import OrderedDict
from threading import Lock

import jwt
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from models.database import SessionLocal, utc_now
from routers import plaid_router as facade
from routers.plaid_router import (
    MAX_WEBHOOK_BYTES,
    SYNC_SOURCE_WEBHOOK,
    WEBHOOK_KEY_CACHE_MAX_ENTRIES,
    WEBHOOK_MAX_AGE_SECONDS,
)
from routers.plaid_router.models import PlaidItem
from utils.limiter import limiter
from utils.logging import get_logger, kv

router = APIRouter()
logger = get_logger(__name__)

_webhook_key_cache: OrderedDict[str, dict] = OrderedDict()
_webhook_key_cache_lock = Lock()


def _get_plaid_verification_key(key_id: str) -> dict:
    now = int(time.time())
    with _webhook_key_cache_lock:
        cached = _webhook_key_cache.get(key_id)
        if cached and (cached.get("expired_at") is None or int(cached["expired_at"]) > now):
            _webhook_key_cache.move_to_end(key_id)
            return cached
        _webhook_key_cache.pop(key_id, None)

    data = facade._plaid_post("/webhook_verification_key/get", {"key_id": key_id})
    key = data.get("key")
    if not isinstance(key, dict):
        raise ValueError("Plaid verification key is missing")
    if (
        key.get("kid") != key_id
        or key.get("alg") != "ES256"
        or key.get("kty") != "EC"
        or key.get("crv") != "P-256"
    ):
        raise ValueError("Plaid verification key is invalid")
    if key.get("expired_at") is not None and int(key["expired_at"]) <= now:
        raise ValueError("Plaid verification key is expired")

    with _webhook_key_cache_lock:
        _webhook_key_cache[key_id] = key
        _webhook_key_cache.move_to_end(key_id)
        while len(_webhook_key_cache) > WEBHOOK_KEY_CACHE_MAX_ENTRIES:
            _webhook_key_cache.popitem(last=False)
    return key


def _verify_plaid_webhook(body: bytes, signed_token: str) -> bool:
    if not facade.PLAID_CLIENT_ID or not facade.PLAID_SECRET or not signed_token or len(signed_token) > 4096:
        return False
    try:
        token_header = jwt.get_unverified_header(signed_token)
        if token_header.get("alg") != "ES256":
            return False
        key_id = token_header.get("kid")
        if not isinstance(key_id, str) or not key_id or len(key_id) > 128:
            return False

        jwk = facade._get_plaid_verification_key(key_id)
        verification_key = jwt.PyJWK.from_dict(jwk).key
        claims = jwt.decode(
            signed_token,
            verification_key,
            algorithms=["ES256"],
            options={"require": ["iat", "request_body_sha256"]},
        )
        issued_at = int(claims["iat"])
        now = int(time.time())
        if issued_at < now - WEBHOOK_MAX_AGE_SECONDS or issued_at > now + 30:
            return False
        claimed_hash = claims["request_body_sha256"]
        if not isinstance(claimed_hash, str):
            return False
        body_hash = hashlib.sha256(body).hexdigest()
        return hmac.compare_digest(body_hash, claimed_hash)
    except (HTTPException, jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        return False


@router.post("/webhook")
@limiter.limit("300/minute")
async def plaid_webhook(request: Request, background: BackgroundTasks):
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_WEBHOOK_BYTES:
                raise HTTPException(status_code=413, detail="Webhook payload is too large")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid Content-Length header")
    body = await request.body()
    if len(body) > MAX_WEBHOOK_BYTES:
        raise HTTPException(status_code=413, detail="Webhook payload is too large")
    signed_token = request.headers.get("Plaid-Verification", "")
    if not await run_in_threadpool(facade._verify_plaid_webhook, body, signed_token):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Webhook payload is not valid JSON")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Webhook payload must be a JSON object")
    webhook_type = payload.get("webhook_type", "")
    webhook_code = payload.get("webhook_code", "")
    item_id      = payload.get("item_id", "")

    if webhook_type == "TRANSACTIONS" and webhook_code in (
        "SYNC_UPDATES_AVAILABLE", "DEFAULT_UPDATE", "INITIAL_UPDATE", "HISTORICAL_UPDATE"
    ):
        db = SessionLocal()
        try:
            item = db.query(PlaidItem).filter(PlaidItem.item_id == item_id).first()
            if item:
                # Stamp receipt before scheduling the sync. This is the field
                # that distinguishes "Plaid never sent it" from "Plaid sent it
                # and we never got it" — comparing this against `/item/get`'s
                # `status.last_webhook.sent_at` answers that directly.
                try:
                    item.last_webhook_at = utc_now()
                    item.last_webhook_code = webhook_code[:60]
                    db.commit()
                except Exception:
                    db.rollback()
                    logger.warning("plaid_webhook_stamp_failed %s", kv(item_id=item.id))
                background.add_task(facade._do_sync_and_notify, item.id, item.user_id, SYNC_SOURCE_WEBHOOK)
        finally:
            db.close()

    return {"status": "ok"}
