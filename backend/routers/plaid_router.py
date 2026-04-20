import os
import requests
from datetime import date, datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import Session
from pydantic import BaseModel

from models.database import get_db, Base, Transaction, Account, SessionLocal, Category
from models.auth import User
from utils.auth import get_current_user
from utils.push_sender import send_push_to_user

router = APIRouter(prefix="/plaid", tags=["plaid"])

PLAID_CLIENT_ID = os.getenv("PLAID_CLIENT_ID", "")
PLAID_SECRET    = os.getenv("PLAID_SECRET", "")
PLAID_ENV       = os.getenv("PLAID_ENV", "sandbox").lower()

_BASE_URLS = {
    "sandbox":     "https://sandbox.plaid.com",
    "development": "https://development.plaid.com",
    "production":  "https://production.plaid.com",
}


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


# ─── Helpers ──────────────────────────────────────────────────────────────────
# New Plaid personal_finance_category.primary values (SCREAMING_SNAKE_CASE)
PLAID_PFC_MAP: dict[str, str] = {
    "FOOD_AND_DRINK":           "Food & Dining",
    "GROCERIES":                "Groceries",
    "TRAVEL":                   "Travel",
    "TRANSPORTATION":           "Transportation",
    "ENTERTAINMENT":            "Entertainment",
    "GENERAL_MERCHANDISE":      "Shopping",
    "MEDICAL":                  "Healthcare",
    "EDUCATION":                "Education",
    "UTILITIES_AND_PHONE":      "Utilities",
    "RENT_AND_UTILITIES":       "Housing & Rent",
    "HOME_IMPROVEMENT":         "Housing & Rent",
    "LOAN_PAYMENTS":            "Housing & Rent",
    "PERSONAL_CARE":            "Shopping",
    "GENERAL_SERVICES":         "Subscriptions",
    "GOVERNMENT_AND_NON_PROFIT":"Other",
    "INCOME":                   "Salary",
    "TRANSFER_IN":              None,   # internal — skip
    "TRANSFER_OUT":             None,   # internal — skip
}

# Legacy Plaid category list values (old API format, kept for fallback)
PLAID_CATEGORY_MAP: dict[str, str] = {
    "food and drink":       "Food & Dining",
    "restaurants":          "Food & Dining",
    "groceries":            "Groceries",
    "supermarkets":         "Groceries",
    "travel":               "Travel",
    "airlines":             "Travel",
    "hotels":               "Travel",
    "transportation":       "Transportation",
    "taxi":                 "Transportation",
    "ride share":           "Transportation",
    "gas stations":         "Transportation",
    "entertainment":        "Entertainment",
    "recreation":           "Entertainment",
    "shops":                "Shopping",
    "shopping":             "Shopping",
    "healthcare":           "Healthcare",
    "medical":              "Healthcare",
    "pharmacy":             "Healthcare",
    "education":            "Education",
    "utilities":            "Utilities",
    "rent":                 "Housing & Rent",
    "housing":              "Housing & Rent",
    "subscription":         "Subscriptions",
    "service":              "Subscriptions",
    "payroll":              "Salary",
    "income":               "Salary",
}


def _is_internal_transfer(tx: dict) -> bool:
    """Return True if this transaction is an internal bank transfer (should be skipped)."""
    # New format
    pfc = tx.get("personal_finance_category") or {}
    primary = pfc.get("primary", "")
    if primary in ("TRANSFER_IN", "TRANSFER_OUT", "TRANSFER"):
        return True
    # Old format
    old_cats = [c.lower() for c in (tx.get("category") or [])]
    return any(c in old_cats for c in ("transfer", "internal account transfer", "account transfer"))


def _resolve_category(tx: dict, user_id: int, db: Session) -> int | None:
    """Resolve a Plaid transaction to a local category ID. Checks new PFC format first."""
    def _lookup(name: str) -> int | None:
        if not name:
            return None
        cat = db.query(Category).filter(
            Category.name == name,
            (Category.user_id == user_id) | (Category.user_id == None),
        ).first()
        return cat.id if cat else None

    # 1. Try personal_finance_category.primary (new Plaid format)
    pfc = tx.get("personal_finance_category") or {}
    primary = pfc.get("primary", "")
    if primary:
        mapped = PLAID_PFC_MAP.get(primary)
        if mapped:
            result = _lookup(mapped)
            if result:
                return result

    # 2. Fall back to legacy category list
    for plaid_cat in (tx.get("category") or []):
        mapped = PLAID_CATEGORY_MAP.get(plaid_cat.lower())
        if mapped:
            result = _lookup(mapped)
            if result:
                return result

    return None


PLAID_TO_ACCOUNT_TYPE = {
    "checking":    "checking",
    "savings":     "savings",
    "credit card": "credit_card",
    "credit":      "credit_card",
    "loan":        "investment",
    "mortgage":    "investment",
    "other":       "checking",
}


def _sync_item(db: Session, item: PlaidItem, user_id: int) -> int:
    """Sync transactions for one Plaid item. Returns count of new transactions added."""
    added_count = 0
    cursor = item.cursor or ""

    # Fetch all Plaid accounts once — map plaid_account_id → local Account
    accounts_data = _plaid_post("/accounts/get", {"access_token": item.access_token})
    plaid_acct_map: dict[str, str] = {}
    for acct in accounts_data.get("accounts", []):
        name = acct.get("official_name") or acct.get("name") or "Unknown"
        plaid_acct_map[acct["account_id"]] = name

    # Cache local accounts by name to avoid repeated DB queries
    local_acct_cache: dict[str, Account] = {}

    def _get_local_account(plaid_account_id: str) -> Optional[Account]:
        name = plaid_acct_map.get(plaid_account_id)
        if not name:
            return None
        if name not in local_acct_cache:
            acct = db.query(Account).filter(
                Account.user_id == user_id,
                Account.name == name,
            ).first()
            local_acct_cache[name] = acct  # type: ignore[assignment]
        return local_acct_cache.get(name)

    while True:
        body: dict = {"access_token": item.access_token, "count": 500}
        if cursor:
            body["cursor"] = cursor
        data = _plaid_post("/transactions/sync", body)

        for tx in data.get("added", []):
            account = _get_local_account(tx["account_id"])
            if not account:
                continue

            plaid_tx_id = tx["transaction_id"]
            # Dedup by Plaid transaction_id (primary)
            existing = db.query(Transaction).filter(
                Transaction.user_id == user_id,
                Transaction.description.like(f"[plaid:{plaid_tx_id}]%"),
            ).first()
            if existing:
                continue
            # Dedup by content (catches same tx imported from duplicate PlaidItems)
            tx_name = tx.get("merchant_name") or tx.get("name") or "Transaction"
            tx_amount = -float(tx["amount"])
            tx_date = date.fromisoformat(tx["date"])
            content_dupe = db.query(Transaction).filter(
                Transaction.user_id == user_id,
                Transaction.account_id == account.id,
                Transaction.amount == tx_amount,
                Transaction.transaction_date == tx_date,
                Transaction.description.like(f"[plaid:%] {tx_name}"),
            ).first()
            if content_dupe:
                continue

            # Skip internal transfers (checking → savings etc.) to avoid double-counting
            if _is_internal_transfer(tx):
                continue

            category_id = _resolve_category(tx, user_id, db)

            new_tx = Transaction(
                user_id=user_id,
                account_id=account.id,
                category_id=category_id,
                amount=tx_amount,
                description=f"[plaid:{plaid_tx_id}] {tx_name}",
                transaction_date=tx_date,
            )
            db.add(new_tx)
            account.balance = float(account.balance) + tx_amount
            added_count += 1

        cursor = data.get("next_cursor", cursor)
        item.cursor = cursor

        if not data.get("has_more", False):
            break

    db.commit()
    return added_count


def _do_sync_and_notify(plaid_item_db_id: int, user_id: int):
    """Background task — creates its own DB session so it outlives the request."""
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
        import traceback
        print(f"[Plaid sync error] item={plaid_item_db_id}: {e}")
        traceback.print_exc()
    finally:
        db.close()


# ─── Routes ───────────────────────────────────────────────────────────────────
@router.post("/link-token")
def create_link_token(current_user: User = Depends(get_current_user)):
    data = _plaid_post("/link/token/create", {
        "user": {"client_user_id": str(current_user.id)},
        "client_name": "Financial Tracker",
        "products": ["transactions"],
        "country_codes": ["US"],
        "language": "en",
        "transactions": {"days_requested": 90},
    })
    return {"link_token": data["link_token"]}


@router.post("/exchange-token")
def exchange_token(
    body: ExchangeTokenRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data = _plaid_post("/item/public_token/exchange", {"public_token": body.public_token})
    access_token = data["access_token"]
    item_id      = data["item_id"]

    if db.query(PlaidItem).filter(PlaidItem.item_id == item_id).first():
        raise HTTPException(status_code=400, detail="This bank is already connected.")

    # Resolve institution name early so we can check for duplicates by name
    institution_name = body.institution_name
    if not institution_name:
        try:
            item_data = _plaid_post("/item/get", {"access_token": data["access_token"]})
            inst_id = item_data["item"].get("institution_id")
            if inst_id:
                inst_data = _plaid_post("/institutions/get_by_id", {
                    "institution_id": inst_id,
                    "country_codes": ["US"],
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

    # Create local accounts matching Plaid accounts
    acct_data = _plaid_post("/accounts/get", {"access_token": access_token})
    for acct in acct_data.get("accounts", []):
        acct_name = acct.get("official_name") or acct.get("name") or institution_name
        acct_type = PLAID_TO_ACCOUNT_TYPE.get((acct.get("subtype") or "other").lower(), "checking")
        balance = float(acct["balances"].get("current") or 0)
        if acct_type == "credit_card":
            balance = -abs(balance)

        if not db.query(Account).filter(Account.user_id == current_user.id, Account.name == acct_name).first():
            db.add(Account(user_id=current_user.id, name=acct_name, type=acct_type, balance=balance, currency="USD"))

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


@router.post("/reset")
def reset_plaid_data(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete all Plaid-imported transactions and items for the current user, then re-sync fresh."""
    # Delete all Plaid-tagged transactions
    plaid_txs = db.query(Transaction).filter(
        Transaction.user_id == current_user.id,
        Transaction.description.like("[plaid:%]%"),
    ).all()
    deleted_count = len(plaid_txs)
    for tx in plaid_txs:
        db.delete(tx)

    # Remove all PlaidItems (keeps the local accounts, just clears transactions + connections)
    items = db.query(PlaidItem).filter(PlaidItem.user_id == current_user.id).all()
    for item in items:
        try:
            _plaid_post("/item/remove", {"access_token": item.access_token})
        except Exception:
            pass
        db.delete(item)

    db.commit()
    return {"message": f"Cleared {deleted_count} Plaid transactions and {len(items)} bank connection(s). Reconnect your bank to start fresh."}
