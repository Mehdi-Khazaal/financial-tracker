import os
import hmac
import hashlib
import json
import requests
import time
from collections import OrderedDict
from datetime import date, datetime
from decimal import Decimal
from threading import Lock
from typing import Optional
import jwt
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict
from starlette.concurrency import run_in_threadpool

from models.database import get_db, Base, Transaction, Account, SessionLocal, utc_now
from models.auth import User
from utils.auth import get_current_user
from utils.limiter import limiter
from utils.logging import get_logger, kv
from utils.push_sender import send_push_to_user
from utils.secret_box import decrypt_secret, encrypt_secret, is_encrypted

router = APIRouter(prefix="/plaid", tags=["plaid"])
logger = get_logger(__name__)

PLAID_CLIENT_ID      = os.getenv("PLAID_CLIENT_ID", "")
PLAID_SECRET         = os.getenv("PLAID_SECRET", "")
PLAID_ENV            = os.getenv("PLAID_ENV", "sandbox").lower()
PLAID_WEBHOOK_URL    = os.getenv("PLAID_WEBHOOK_URL", "")

MAX_WEBHOOK_BYTES = 1_000_000
WEBHOOK_MAX_AGE_SECONDS = 5 * 60
WEBHOOK_KEY_CACHE_MAX_ENTRIES = 16
_webhook_key_cache: OrderedDict[str, dict] = OrderedDict()
_webhook_key_cache_lock = Lock()

_BASE_URLS = {
    "sandbox":     "https://sandbox.plaid.com",
    "development": "https://development.plaid.com",
    "production":  "https://production.plaid.com",
}

PLAID_TO_ACCOUNT_TYPE = {
    "checking":    "checking",
    "savings":     "savings",
    "credit card": "credit_card",
    "credit":      "credit_card",
    "loan":        "investment",
    "mortgage":    "investment",
    "other":       "checking",
}


# ─── DB Model ─────────────────────────────────────────────────────────────────
class PlaidItem(Base):
    __tablename__ = "plaid_items"

    id               = Column(Integer, primary_key=True, index=True)
    user_id          = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    access_token     = Column(Text, nullable=False)
    item_id          = Column(String(200), nullable=False, unique=True)
    institution_name = Column(String(200), nullable=True)
    cursor           = Column(Text, nullable=True)
    created_at       = Column(DateTime, default=utc_now)


# ─── Schemas ──────────────────────────────────────────────────────────────────
class ExchangeTokenRequest(BaseModel):
    public_token: str
    institution_name: Optional[str] = None


class PlaidItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    institution_name: Optional[str]
    created_at: datetime


# ─── Plaid API helper ─────────────────────────────────────────────────────────
def _plaid_post(path: str, body: dict) -> dict:
    url = _BASE_URLS.get(PLAID_ENV, _BASE_URLS["sandbox"]) + path
    body = {**body, "client_id": PLAID_CLIENT_ID, "secret": PLAID_SECRET}
    try:
        resp = requests.post(url, json=body, timeout=30)
    except requests.RequestException as exc:
        logger.warning("plaid_request_failed %s", kv(path=path, error=str(exc)))
        raise HTTPException(status_code=502, detail="Plaid is temporarily unavailable")
    if not resp.ok:
        logger.warning("plaid_response_error %s", kv(path=path, status_code=resp.status_code))
        raise HTTPException(status_code=502, detail="Plaid returned an error")
    try:
        data = resp.json()
    except ValueError:
        logger.warning("plaid_invalid_response %s", kv(path=path))
        raise HTTPException(status_code=502, detail="Plaid returned an invalid response")
    if data.get("error_code"):
        logger.warning("plaid_api_error %s", kv(path=path, error_code=data.get("error_code")))
        raise HTTPException(status_code=502, detail="Plaid returned an error")
    return data


def _item_access_token(db: Session, item: PlaidItem) -> str:
    token = decrypt_secret(item.access_token)
    if not is_encrypted(item.access_token):
        item.access_token = encrypt_secret(token)
        db.flush()
    return token


def _plaid_amount(tx: dict) -> Decimal:
    return Decimal(str(tx["amount"])) * Decimal("-1")


def _plaid_description(tx: dict, fallback: Optional[str] = None) -> str:
    return tx.get("merchant_name") or tx.get("name") or fallback or "Transaction"


def _apply_pending_replacement(db: Session, tx: dict, user_id: int, local_acct: Account) -> bool:
    """Update a categorized pending transaction when Plaid replaces it with the posted one."""
    pending_tx_id = tx.get("pending_transaction_id")
    if not pending_tx_id:
        return False

    existing = db.query(Transaction).filter(
        Transaction.user_id == user_id,
        Transaction.plaid_tx_id == pending_tx_id,
    ).first()
    if not existing:
        return False

    posted = db.query(Transaction).filter(
        Transaction.user_id == user_id,
        Transaction.plaid_tx_id == tx["transaction_id"],
    ).first()
    if posted:
        if posted.category_id is None:
            posted.category_id = existing.category_id
        posted.account_id = local_acct.id
        posted.amount = _plaid_amount(tx)
        posted.description = _plaid_description(tx, posted.description)
        posted.transaction_date = date.fromisoformat(tx["date"])
        db.delete(existing)
        return True

    existing.account_id = local_acct.id
    existing.amount = _plaid_amount(tx)
    existing.description = _plaid_description(tx, existing.description)
    existing.transaction_date = date.fromisoformat(tx["date"])
    existing.plaid_tx_id = tx["transaction_id"]
    return True


# ─── Sync logic ───────────────────────────────────────────────────────────────
def _sync_item(db: Session, item: PlaidItem, user_id: int) -> int:
    """Sync one Plaid item. Returns number of new transactions added."""
    added_count = 0
    cursor = item.cursor or ""

    # Fetch accounts — update local balances and build plaid_account_id → Account map
    access_token = _item_access_token(db, item)
    accounts_data = _plaid_post("/accounts/get", {"access_token": access_token})
    local_acct_cache: dict[str, Optional[Account]] = {}

    for acct in accounts_data.get("accounts", []):
        plaid_acct_id = acct["account_id"]
        acct_name = acct.get("official_name") or acct.get("name") or "Unknown"
        subtype = (acct.get("subtype") or "other").lower()
        balance = Decimal(str(acct["balances"].get("current") or 0))
        if subtype in ("credit card", "credit"):
            balance = -abs(balance)

        # Match by plaid_account_id; fall back to name for pre-existing accounts
        local_acct = db.query(Account).filter(
            Account.user_id == user_id,
            Account.plaid_account_id == plaid_acct_id,
        ).first()
        if not local_acct:
            local_acct = db.query(Account).filter(
                Account.user_id == user_id,
                Account.name == acct_name,
                Account.plaid_account_id == None,
            ).first()
            if local_acct:
                local_acct.plaid_account_id = plaid_acct_id

        if local_acct:
            local_acct.balance = Decimal(str(balance))
            local_acct_cache[plaid_acct_id] = local_acct
        else:
            local_acct_cache[plaid_acct_id] = None

    db.flush()

    # Page through /transactions/sync, committing after each page
    while True:
        body: dict = {"access_token": access_token, "count": 500}
        if cursor:
            body["cursor"] = cursor
        data = _plaid_post("/transactions/sync", body)

        # Added — bulk insert; ON CONFLICT DO NOTHING is atomic, no race condition possible
        rows_to_add = []
        for tx in data.get("added", []):
            local_acct = local_acct_cache.get(tx["account_id"])
            if not local_acct:
                continue
            if _apply_pending_replacement(db, tx, user_id, local_acct):
                continue
            rows_to_add.append({
                "user_id":          user_id,
                "account_id":       local_acct.id,
                "category_id":      None,
                "amount":           _plaid_amount(tx),  # Plaid positive = debit; we store debits as negative
                "description":      _plaid_description(tx),
                "plaid_tx_id":      tx["transaction_id"],
                "transaction_date": date.fromisoformat(tx["date"]),
            })
        if rows_to_add:
            result = db.execute(pg_insert(Transaction).values(rows_to_add).on_conflict_do_nothing())
            added_count += result.rowcount

        # Modified — update amount/description/date if Plaid revised a pending transaction
        for tx in data.get("modified", []):
            existing = db.query(Transaction).filter(
                Transaction.user_id == user_id,
                Transaction.plaid_tx_id == tx["transaction_id"],
            ).first()
            if existing:
                existing.amount           = _plaid_amount(tx)
                existing.description      = _plaid_description(tx, existing.description)
                existing.transaction_date = date.fromisoformat(tx["date"])

        # Removed — Plaid pulled the transaction back (e.g. a declined pending charge)
        for tx in data.get("removed", []):
            existing = db.query(Transaction).filter(
                Transaction.user_id == user_id,
                Transaction.plaid_tx_id == tx["transaction_id"],
            ).first()
            if existing:
                db.delete(existing)

        cursor = data.get("next_cursor", cursor)
        item.cursor = cursor
        db.commit()  # Commit per page — cursor is saved even if a later page fails

        if not data.get("has_more", False):
            break

    return added_count


def _do_sync_and_notify(plaid_item_db_id: int, user_id: int):
    """Background task — owns its own DB session so it outlives the request."""
    db = SessionLocal()
    try:
        item = db.query(PlaidItem).filter(PlaidItem.id == plaid_item_db_id).first()
        if not item:
            return
        count = _sync_item(db, item, user_id)
        if count > 0:
            send_push_to_user(
                db, user_id,
                "Bank sync complete",
                f"{count} new transaction{'s' if count != 1 else ''} imported from {item.institution_name or 'your bank'}.",
                url="/transactions",
                tag="plaid-sync",
            )
    except Exception:
        logger.exception("plaid_sync_failed %s", kv(item_id=plaid_item_db_id, user_id=user_id))
    finally:
        db.close()


# ─── Routes ───────────────────────────────────────────────────────────────────
@router.post("/link-token")
def create_link_token(current_user: User = Depends(get_current_user)):
    body: dict = {
        "user":          {"client_user_id": str(current_user.id)},
        "client_name":   "Financial Tracker",
        "products":      ["transactions"],
        "country_codes": ["US"],
        "language":      "en",
        "transactions":  {"days_requested": 90},
    }
    if PLAID_WEBHOOK_URL:
        body["webhook"] = PLAID_WEBHOOK_URL
    data = _plaid_post("/link/token/create", body)
    return {"link_token": data["link_token"]}


@router.post("/exchange-token")
def exchange_token(
    body: ExchangeTokenRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data         = _plaid_post("/item/public_token/exchange", {"public_token": body.public_token})
    access_token = data["access_token"]
    item_id      = data["item_id"]

    if db.query(PlaidItem).filter(PlaidItem.item_id == item_id).first():
        raise HTTPException(status_code=400, detail="This bank is already connected.")

    institution_name = body.institution_name
    if not institution_name:
        try:
            item_data = _plaid_post("/item/get", {"access_token": access_token})
            inst_id = item_data["item"].get("institution_id")
            if inst_id:
                inst_data = _plaid_post("/institutions/get_by_id", {
                    "institution_id": inst_id,
                    "country_codes":  ["US"],
                })
                institution_name = inst_data["institution"]["name"]
        except Exception as exc:
            logger.info(
                "plaid_institution_lookup_failed %s",
                kv(user_id=current_user.id, error_type=type(exc).__name__),
            )
        institution_name = institution_name or "Bank"

    if db.query(PlaidItem).filter(
        PlaidItem.user_id == current_user.id,
        PlaidItem.institution_name == institution_name,
    ).first():
        raise HTTPException(status_code=400, detail=f"{institution_name} is already connected.")

    item = PlaidItem(
        user_id=current_user.id,
        access_token=encrypt_secret(access_token),
        item_id=item_id,
        institution_name=institution_name,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    # Create a local account for each Plaid account, keyed by plaid_account_id
    acct_data = _plaid_post("/accounts/get", {"access_token": access_token})
    for acct in acct_data.get("accounts", []):
        plaid_acct_id = acct["account_id"]
        acct_name     = acct.get("official_name") or acct.get("name") or institution_name
        acct_type     = PLAID_TO_ACCOUNT_TYPE.get((acct.get("subtype") or "other").lower(), "checking")
        balance       = Decimal(str(acct["balances"].get("current") or 0))
        if acct_type == "credit_card":
            balance = -abs(balance)

        existing = (
            db.query(Account).filter(
                Account.user_id == current_user.id,
                Account.plaid_account_id == plaid_acct_id,
            ).first()
            or db.query(Account).filter(
                Account.user_id == current_user.id,
                Account.name == acct_name,
            ).first()
        )

        if existing:
            existing.plaid_account_id = plaid_acct_id
            existing.balance = Decimal(str(balance))
        else:
            db.add(Account(
                user_id=current_user.id,
                name=acct_name,
                type=acct_type,
                balance=balance,
                currency="USD",
                plaid_account_id=plaid_acct_id,
            ))

    db.commit()
    background.add_task(_do_sync_and_notify, item.id, current_user.id)
    return {"message": f"{institution_name} connected successfully.", "item_id": item_id}


@router.get("/items", response_model=list[PlaidItemResponse])
def list_items(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(PlaidItem).filter(PlaidItem.user_id == current_user.id).all()


@router.delete("/items/{item_id}")
def disconnect_item(item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    item = db.query(PlaidItem).filter(PlaidItem.id == item_id, PlaidItem.user_id == current_user.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    try:
        _plaid_post("/item/remove", {"access_token": _item_access_token(db, item)})
    except Exception as exc:
        logger.warning(
            "plaid_remote_disconnect_failed %s",
            kv(item_id=item.id, user_id=current_user.id, error_type=type(exc).__name__),
        )
    db.delete(item)
    db.commit()
    return {"message": "Bank disconnected."}


@router.post("/sync")
def sync_all(
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    items = db.query(PlaidItem).filter(PlaidItem.user_id == current_user.id).all()
    if not items:
        raise HTTPException(status_code=404, detail="No connected banks.")
    for item in items:
        background.add_task(_do_sync_and_notify, item.id, current_user.id)
    return {"message": f"Syncing {len(items)} bank(s) in background."}


@router.post("/replay")
def replay_all_transactions(
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reset cursors so the next sync replays all historical transactions. Dedup prevents re-imports."""
    items = db.query(PlaidItem).filter(PlaidItem.user_id == current_user.id).all()
    if not items:
        raise HTTPException(status_code=404, detail="No connected banks.")
    for item in items:
        item.cursor = None
    db.commit()
    for item in items:
        background.add_task(_do_sync_and_notify, item.id, current_user.id)
    return {"message": f"Cursor reset for {len(items)} bank(s). Full replay running in background."}


@router.post("/reset")
def reset_plaid_data(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete all Plaid-imported transactions and bank connections for the current user."""
    plaid_txs = db.query(Transaction).filter(
        Transaction.user_id == current_user.id,
        Transaction.plaid_tx_id.isnot(None),
    ).all()
    deleted_count = len(plaid_txs)
    for tx in plaid_txs:
        db.delete(tx)

    items = db.query(PlaidItem).filter(PlaidItem.user_id == current_user.id).all()
    for item in items:
        try:
            _plaid_post("/item/remove", {"access_token": _item_access_token(db, item)})
        except Exception as exc:
            logger.warning(
                "plaid_remote_reset_failed %s",
                kv(item_id=item.id, user_id=current_user.id, error_type=type(exc).__name__),
            )
        db.delete(item)

    db.commit()
    return {"message": f"Cleared {deleted_count} Plaid transactions and {len(items)} bank connection(s). Reconnect your bank to start fresh."}


# ─── Webhook ──────────────────────────────────────────────────────────────────
def _get_plaid_verification_key(key_id: str) -> dict:
    now = int(time.time())
    with _webhook_key_cache_lock:
        cached = _webhook_key_cache.get(key_id)
        if cached and (cached.get("expired_at") is None or int(cached["expired_at"]) > now):
            _webhook_key_cache.move_to_end(key_id)
            return cached
        _webhook_key_cache.pop(key_id, None)

    data = _plaid_post("/webhook_verification_key/get", {"key_id": key_id})
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
    if not PLAID_CLIENT_ID or not PLAID_SECRET or not signed_token or len(signed_token) > 4096:
        return False
    try:
        token_header = jwt.get_unverified_header(signed_token)
        if token_header.get("alg") != "ES256":
            return False
        key_id = token_header.get("kid")
        if not isinstance(key_id, str) or not key_id or len(key_id) > 128:
            return False

        jwk = _get_plaid_verification_key(key_id)
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
    if not await run_in_threadpool(_verify_plaid_webhook, body, signed_token):
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
                background.add_task(_do_sync_and_notify, item.id, item.user_id)
        finally:
            db.close()

    return {"status": "ok"}
