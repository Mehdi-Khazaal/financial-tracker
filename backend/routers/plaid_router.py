import os
import hmac
import hashlib
import json
import traceback
import requests
import time
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session
from pydantic import BaseModel

from models.database import get_db, Base, Transaction, Account, SessionLocal
from models.auth import User
from utils.auth import get_current_user
from utils.push_sender import send_push_to_user

router = APIRouter(prefix="/plaid", tags=["plaid"])

PLAID_CLIENT_ID      = os.getenv("PLAID_CLIENT_ID", "")
PLAID_SECRET         = os.getenv("PLAID_SECRET", "")
PLAID_ENV            = os.getenv("PLAID_ENV", "sandbox").lower()
PLAID_WEBHOOK_URL    = os.getenv("PLAID_WEBHOOK_URL", "")
PLAID_WEBHOOK_SECRET = os.getenv("PLAID_WEBHOOK_SECRET", "")

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
    created_at       = Column(DateTime, default=datetime.utcnow)


# ─── Schemas ──────────────────────────────────────────────────────────────────
class ExchangeTokenRequest(BaseModel):
    public_token: str
    institution_name: Optional[str] = None


class PlaidItemResponse(BaseModel):
    id: int
    institution_name: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ─── Plaid API helper ─────────────────────────────────────────────────────────
def _plaid_post(path: str, body: dict) -> dict:
    url = _BASE_URLS.get(PLAID_ENV, _BASE_URLS["sandbox"]) + path
    body = {**body, "client_id": PLAID_CLIENT_ID, "secret": PLAID_SECRET}
    resp = requests.post(url, json=body, timeout=30)
    if not resp.ok:
        raise HTTPException(status_code=502, detail=f"Plaid error: {resp.text}")
    data = resp.json()
    if data.get("error_code"):
        raise HTTPException(status_code=502, detail=f"Plaid API error: {data.get('error_message', data['error_code'])}")
    return data


# ─── Sync logic ───────────────────────────────────────────────────────────────
def _sync_item(db: Session, item: PlaidItem, user_id: int) -> int:
    """Sync one Plaid item. Returns number of new transactions added."""
    added_count = 0
    cursor = item.cursor or ""

    # Fetch accounts — update local balances and build plaid_account_id → Account map
    accounts_data = _plaid_post("/accounts/get", {"access_token": item.access_token})
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
        body: dict = {"access_token": item.access_token, "count": 500}
        if cursor:
            body["cursor"] = cursor
        data = _plaid_post("/transactions/sync", body)

        # Added — bulk insert; ON CONFLICT DO NOTHING is atomic, no race condition possible
        rows_to_add = []
        for tx in data.get("added", []):
            local_acct = local_acct_cache.get(tx["account_id"])
            if not local_acct:
                continue
            rows_to_add.append({
                "user_id":          user_id,
                "account_id":       local_acct.id,
                "category_id":      None,
                "amount":           Decimal(str(tx["amount"])) * Decimal("-1"),  # Plaid positive = debit; we store debits as negative
                "description":      tx.get("merchant_name") or tx.get("name") or "Transaction",
                "plaid_tx_id":      tx["transaction_id"],
                "transaction_date": date.fromisoformat(tx["date"]),
            })
        if rows_to_add:
            result = db.execute(pg_insert(Transaction).values(rows_to_add).on_conflict_do_nothing())
            added_count += result.rowcount

        # Modified — update amount/description/date if Plaid revised a pending transaction
        for tx in data.get("modified", []):
            existing = db.query(Transaction).filter(Transaction.plaid_tx_id == tx["transaction_id"]).first()
            if existing:
                existing.amount           = Decimal(str(tx["amount"])) * Decimal("-1")
                existing.description      = tx.get("merchant_name") or tx.get("name") or existing.description
                existing.transaction_date = date.fromisoformat(tx["date"])

        # Removed — Plaid pulled the transaction back (e.g. a declined pending charge)
        for tx in data.get("removed", []):
            existing = db.query(Transaction).filter(Transaction.plaid_tx_id == tx["transaction_id"]).first()
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
    except Exception as e:
        print(f"[Plaid sync error] item={plaid_item_db_id}: {e}")
        traceback.print_exc()
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
        except Exception:
            pass
        institution_name = institution_name or "Bank"

    if db.query(PlaidItem).filter(
        PlaidItem.user_id == current_user.id,
        PlaidItem.institution_name == institution_name,
    ).first():
        raise HTTPException(status_code=400, detail=f"{institution_name} is already connected.")

    item = PlaidItem(
        user_id=current_user.id,
        access_token=access_token,
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
        _plaid_post("/item/remove", {"access_token": item.access_token})
    except Exception:
        pass
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
            _plaid_post("/item/remove", {"access_token": item.access_token})
        except Exception:
            pass
        db.delete(item)

    db.commit()
    return {"message": f"Cleared {deleted_count} Plaid transactions and {len(items)} bank connection(s). Reconnect your bank to start fresh."}


# ─── Webhook ──────────────────────────────────────────────────────────────────
def _verify_plaid_webhook(body: bytes, headers: dict) -> bool:
    if not PLAID_WEBHOOK_SECRET:
        return True
    sig      = headers.get("plaid-verification") or headers.get("Plaid-Verification") or ""
    expected = hmac.new(PLAID_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)


@router.post("/webhook")
async def plaid_webhook(request: Request, background: BackgroundTasks):
    body = await request.body()
    if not _verify_plaid_webhook(body, dict(request.headers)):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    payload      = json.loads(body)
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
