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
from services.transaction_enrichment import (
    enrich_transaction_input,
    resolve_transaction_merchant,
    suggest_transaction_category,
)
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

# How much history to request when a *new* Item is linked. Plaid's documented
# maximum for `transactions.days_requested` is 730 days.
#
# Raised from 90 because recurring detection is bounded by it: three
# occurrences of a monthly charge need ~90 days with no margin, and a
# quarterly charge needs ~270. At 90 days a quarterly subscription is not
# detectable at all, by us or by Plaid.
#
# This applies only to Items linked from now on. Plaid fixes the history
# window when an Item is created, so **existing connections keep their 90-day
# window** and gain nothing until they are re-linked. Institutions also vary:
# many return less than the requested window, and some return as little as 30
# days regardless. Treat 730 as a ceiling, not a guarantee.
PLAID_DAYS_REQUESTED = 730

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


def _optional_date(value) -> Optional[date]:
    """Parse a Plaid ISO date, tolerating null and malformed values."""
    if not value or not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _plaid_metadata(tx: dict) -> dict:
    """Extract the enrichment fields worth persisting from a Plaid transaction.

    Only what carries merchant identity or recurrence signal. Location, logo,
    website and the counterparty array are deliberately not read: none of them
    is needed to identify a merchant once `merchant_entity_id` is stored, and
    they are the bulkiest and most personal parts of the payload.
    """
    pfc = tx.get("personal_finance_category")
    if not isinstance(pfc, dict):
        pfc = {}
    return {
        "plaid_merchant_entity_id": tx.get("merchant_entity_id") or None,
        "plaid_merchant_name": tx.get("merchant_name") or None,
        # Plaid's `name` is the raw bank string. `description` collapses it
        # with `merchant_name`, so keeping it separately is the only way to
        # re-derive a merchant key later without re-fetching from Plaid.
        "original_description": tx.get("name") or None,
        "personal_finance_category_primary": pfc.get("primary") or None,
        "personal_finance_category_detailed": pfc.get("detailed") or None,
        "payment_channel": tx.get("payment_channel") or None,
        "transaction_code": tx.get("transaction_code") or None,
        "authorized_date": _optional_date(tx.get("authorized_date")),
        "iso_currency_code": tx.get("iso_currency_code")
        or tx.get("unofficial_currency_code")
        or None,
    }


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
    metadata = _plaid_metadata(tx)

    if posted:
        # Carry the pending row's category across so a categorization the user
        # made while the charge was pending is not lost when it settles.
        if posted.category_id is None:
            posted.category_id = existing.category_id
            posted.category_source = existing.category_source
        posted.account_id = local_acct.id
        posted.amount = _plaid_amount(tx)
        posted.description = _plaid_description(tx, posted.description)
        posted.transaction_date = date.fromisoformat(tx["date"])
        _apply_metadata(posted, metadata)
        db.delete(existing)
        return True

    existing.account_id = local_acct.id
    existing.amount = _plaid_amount(tx)
    existing.description = _plaid_description(tx, existing.description)
    existing.transaction_date = date.fromisoformat(tx["date"])
    existing.plaid_tx_id = tx["transaction_id"]
    _apply_metadata(existing, metadata)
    return True


def _apply_metadata(row: Transaction, metadata: dict) -> None:
    """Write Plaid metadata onto a row and re-derive its merchant key.

    Leaves `category_id` alone — replacement and modification must never
    disturb a category the user is looking at.
    """
    for field, value in metadata.items():
        setattr(row, field, value)
    identity = resolve_transaction_merchant(
        row.description,
        plaid_merchant_entity_id=row.plaid_merchant_entity_id,
    )
    row.merchant_key = identity.key or None


def _uniform_rows(rows: list[dict]) -> list[dict]:
    """Give every row the same keys, filling the gaps with None.

    A multi-row INSERT is compiled from the *first* row's key set, and a column
    missing from a later row needs a Python-side default that these nullable
    columns do not have. One row carrying an extra key therefore raises
    CompileError and **no** row on the page is written — the statement never
    reaches the database. Enrichment is the source of that asymmetry, since it
    fills the category fields only when it has an answer, so the rows are
    squared up here rather than trusting every producer to stay in step.

    Order is first-seen, not set order, so the generated SQL is stable.
    """
    keys = {key: None for row in rows for key in row}
    return [{key: row.get(key) for key in keys} for row in rows]


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

        # Added — bulk insert; ON CONFLICT DO NOTHING is atomic, no race condition possible.
        # Skip pending charges entirely — they get replaced by a posted transaction with a
        # different transaction_id, forcing the user to re-categorize each time. We only
        # import posted (settled) transactions so each purchase is categorized once.
        rows_to_add = []
        for tx in data.get("added", []):
            if tx.get("pending"):
                continue
            local_acct = local_acct_cache.get(tx["account_id"])
            if not local_acct:
                continue
            if _apply_pending_replacement(db, tx, user_id, local_acct):
                continue
            description = _plaid_description(tx)
            row = {
                "user_id":          user_id,
                "account_id":       local_acct.id,
                "category_id":      None,
                "amount":           _plaid_amount(tx),  # Plaid positive = debit; we store debits as negative
                "description":      description,
                "plaid_tx_id":      tx["transaction_id"],
                "transaction_date": date.fromisoformat(tx["date"]),
                **_plaid_metadata(tx),
            }
            # Same enrichment step manual entry uses, so a bank-imported row
            # gets a merchant key and a category suggestion instead of landing
            # permanently uncategorized. It stages only — the bulk insert below
            # still owns the write, so ON CONFLICT DO NOTHING and the per-page
            # cursor commit are untouched.
            rows_to_add.append(enrich_transaction_input(db, user_id, row))
        if rows_to_add:
            result = db.execute(
                pg_insert(Transaction).values(_uniform_rows(rows_to_add)).on_conflict_do_nothing()
            )
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
                for field, value in _plaid_metadata(tx).items():
                    setattr(existing, field, value)
                identity = resolve_transaction_merchant(
                    existing.description,
                    plaid_merchant_entity_id=existing.plaid_merchant_entity_id,
                )
                existing.merchant_key = identity.key or None
                # Only fill a category that is still empty. A category the
                # user set — or one we inferred and they left in place — is
                # never overwritten by a later sync.
                if existing.category_id is None:
                    category_id, source = suggest_transaction_category(
                        db,
                        user_id,
                        identity,
                        pfc_primary=existing.personal_finance_category_primary,
                    )
                    if category_id is not None:
                        existing.category_id = category_id
                        existing.category_source = source

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
        "transactions":  {"days_requested": PLAID_DAYS_REQUESTED},
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


# ─── Recurring add-on capability probe ────────────────────────────────────────
# `/transactions/recurring/get` is an **optional add-on**. Holding the
# Transactions product does not imply access to it, so nothing may assume it
# works. This probe answers "is it available on this account, in this
# environment" without persisting anything — persisting streams is Phase 5B.
#
# Deliberately isolated from `_sync_item`: normal transaction sync must keep
# working unchanged when the add-on is absent.

# Plaid error codes that mean "not entitled", as distinct from a transient
# failure. Treated as a definitive "unavailable" answer rather than an error.
_RECURRING_UNAVAILABLE_CODES = {
    "PRODUCT_NOT_ENABLED",
    "PRODUCTS_NOT_SUPPORTED",
    "INVALID_PRODUCT",
    "ADDITION_LIMIT",
    "INSUFFICIENT_CREDENTIALS",
    "NOT_ENTITLED",
}

# The five states this probe can report. `transient_error` is deliberately
# distinct from `unavailable`: "Plaid is briefly unhappy" and "you are not
# entitled to this add-on" call for completely different responses, and
# collapsing them would make a temporary outage look like a permanent block.
CAPABILITY_AVAILABLE = "available"
CAPABILITY_NO_STREAMS = "available_no_streams"
CAPABILITY_UNAVAILABLE = "unavailable"
CAPABILITY_TRANSIENT_ERROR = "transient_error"
CAPABILITY_NOT_CONFIGURED = "not_configured"

# How long a single probe call may take. Bounded so a slow Plaid response
# cannot hold a request open indefinitely.
RECURRING_PROBE_TIMEOUT_SECONDS = 15


def _probe_recurring_for_item(access_token: str) -> dict:
    """One raw call to `/transactions/recurring/get`, classified.

    Returns a plain dict with no token or secret in it. Never raises — the
    caller is a diagnostic endpoint, and "Plaid is down" is a result, not a
    failure of the probe.
    """
    url = _BASE_URLS.get(PLAID_ENV, _BASE_URLS["sandbox"]) + "/transactions/recurring/get"
    body = {"access_token": access_token, "client_id": PLAID_CLIENT_ID, "secret": PLAID_SECRET}
    try:
        resp = requests.post(url, json=body, timeout=RECURRING_PROBE_TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        return {"status": CAPABILITY_TRANSIENT_ERROR, "detail": f"Network error contacting Plaid: {type(exc).__name__}"}

    try:
        payload = resp.json()
    except ValueError:
        return {"status": CAPABILITY_TRANSIENT_ERROR, "detail": f"Non-JSON response (HTTP {resp.status_code})"}

    error_code = payload.get("error_code")
    if error_code:
        if error_code in _RECURRING_UNAVAILABLE_CODES:
            return {
                "status": CAPABILITY_UNAVAILABLE,
                "detail": "The recurring transactions add-on is not enabled for this Plaid account.",
                "plaid_error_code": error_code,
            }
        return {
            "status": CAPABILITY_TRANSIENT_ERROR,
            "detail": "Plaid returned an error. This may be transient.",
            "plaid_error_code": error_code,
        }

    if not resp.ok:
        return {"status": CAPABILITY_TRANSIENT_ERROR, "detail": f"HTTP {resp.status_code} from Plaid"}

    inflow = payload.get("inflow_streams") or []
    outflow = payload.get("outflow_streams") or []
    if not inflow and not outflow:
        return {
            "status": CAPABILITY_NO_STREAMS,
            "detail": "The add-on is enabled, but Plaid has not identified any recurring streams for this Item yet.",
            "inflow_streams": 0,
            "outflow_streams": 0,
        }

    return {
        "status": CAPABILITY_AVAILABLE,
        "detail": "The recurring transactions add-on is enabled and returning streams.",
        "inflow_streams": len(inflow),
        "outflow_streams": len(outflow),
    }


@router.get("/recurring-capability")
def check_recurring_capability(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Report whether the recurring add-on is usable, per connected bank.

    Diagnostic only — nothing is stored. Returns the institution name and a
    classified status per Item; access tokens and Plaid credentials never
    appear in the response.
    """
    if not PLAID_CLIENT_ID or not PLAID_SECRET:
        return {
            "environment": PLAID_ENV,
            "overall": CAPABILITY_NOT_CONFIGURED,
            "detail": "Plaid credentials are not configured in this environment.",
            "items": [],
        }

    items = db.query(PlaidItem).filter(PlaidItem.user_id == current_user.id).all()
    if not items:
        return {
            "environment": PLAID_ENV,
            "overall": CAPABILITY_NOT_CONFIGURED,
            "detail": "No banks are connected, so the add-on cannot be probed.",
            "items": [],
        }

    results = []
    for item in items:
        try:
            outcome = _probe_recurring_for_item(_item_access_token(db, item))
        except Exception as exc:
            outcome = {"status": CAPABILITY_TRANSIENT_ERROR, "detail": f"Probe failed: {type(exc).__name__}"}
        results.append({"institution_name": item.institution_name, **outcome})
    db.commit()  # `_item_access_token` may re-encrypt a legacy plaintext token.

    statuses = {row["status"] for row in results}
    if CAPABILITY_AVAILABLE in statuses:
        overall = CAPABILITY_AVAILABLE
    elif CAPABILITY_NO_STREAMS in statuses:
        overall = CAPABILITY_NO_STREAMS
    elif CAPABILITY_UNAVAILABLE in statuses:
        overall = CAPABILITY_UNAVAILABLE
    else:
        overall = CAPABILITY_TRANSIENT_ERROR

    logger.info(
        "plaid_recurring_capability_probe %s",
        kv(user_id=current_user.id, environment=PLAID_ENV, overall=overall, items=len(results)),
    )
    return {"environment": PLAID_ENV, "overall": overall, "items": results}


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
