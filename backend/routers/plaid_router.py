import os
import re
import hmac
import hashlib
import json
import requests
import anthropic as _anthropic
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
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
# Plaid personal_finance_category.detailed — checked first for precise matches
PLAID_PFC_DETAILED_MAP: dict[str, str] = {
    "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS": "Health & Fitness",
    "PERSONAL_CARE_HAIR_AND_BEAUTY":          "Personal Care",
    "PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING": "Personal Care",
    "PERSONAL_CARE_MASSAGE_AND_SPA":          "Personal Care",
    "ENTERTAINMENT_SPORTING_EVENTS":          "Entertainment",
    "ENTERTAINMENT_RECREATION":               "Health & Fitness",
}

# Plaid personal_finance_category.primary values (SCREAMING_SNAKE_CASE)
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
    "PERSONAL_CARE":            "Personal Care",
    "GENERAL_SERVICES":         "Subscriptions",
    "GOVERNMENT_AND_NON_PROFIT":"Other",
    "INCOME":                   "Other Income",
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
    "income":               "Other Income",
}


def _is_internal_transfer(tx: dict) -> bool:
    """Return True if this transaction is an internal bank transfer (should be skipped)."""
    # Old Plaid category format — only skip when explicitly labeled as internal
    old_cats = [c.lower() for c in (tx.get("category") or [])]
    if any(c in old_cats for c in ("internal account transfer", "account transfer")):
        return True
    # New format — skip inter-account transfers and credit card payments (both sides)
    pfc = tx.get("personal_finance_category") or {}
    detailed = (pfc.get("detailed") or "").upper()
    if detailed in (
        "TRANSFER_IN_ACCOUNT_TRANSFER",
        "TRANSFER_OUT_ACCOUNT_TRANSFER",
        "TRANSFER_IN_SAVINGS_TRANSFER",
        "TRANSFER_OUT_SAVINGS_TRANSFER",
        "TRANSFER_IN_DEPOSIT",
        "TRANSFER_OUT_DEPOSIT",
        "TRANSFER_IN_CARD_PAYMENT",
        "TRANSFER_OUT_CARD_PAYMENT",
    ):
        return True
    # Name-pattern fallback for banks using old Plaid format
    name = (tx.get("name") or "").upper()
    if "CD DEPOSIT" in name or "CD WITHDRAWAL" in name:
        return True
    # PNC online transfers between own accounts (e.g. "ONLINE TRANSFER TO XXXXX2253")
    if "ONLINE TRANSFER" in name:
        return True
    # Credit card payment patterns — mobile ("CAPITAL ONE MOBILE PYMT") and ACH ("CAPITAL ONE ACH WEB CAPITAL PMT")
    if "CAPITAL ONE MOBILE PYMT" in name or "CAPITAL PMT" in name:
        return True
    return False


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

    # 1. Try personal_finance_category.detailed first (most precise)
    pfc = tx.get("personal_finance_category") or {}
    detailed = (pfc.get("detailed") or "").upper()
    if detailed:
        mapped = PLAID_PFC_DETAILED_MAP.get(detailed)
        if mapped:
            result = _lookup(mapped)
            if result:
                return result

    # 2. Try personal_finance_category.primary (new Plaid format)
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


ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")


def _ai_categorize_batch(txs: list[dict], user_id: int, db: Session) -> dict[str, dict]:
    """
    AI-categorize a batch of Plaid transactions.
    Returns dict: plaid_tx_id → {"is_transfer": bool, "category_id": int | None}
    Falls back to empty dict on any error so the sync never fails.
    """
    if not ANTHROPIC_API_KEY or not txs:
        return {}

    all_cats = db.query(Category).filter(
        (Category.user_id == user_id) | (Category.user_id.is_(None))
    ).all()
    expense_cats = [c.name for c in all_cats if c.type == "expense"]
    income_cats  = [c.name for c in all_cats if c.type == "income"]

    tx_items = []
    for tx in txs:
        pfc = tx.get("personal_finance_category") or {}
        pfc_hint = pfc.get("detailed") or pfc.get("primary") or ""
        tx_items.append({
            "id":     tx["transaction_id"],
            "name":   tx.get("merchant_name") or tx.get("name") or "",
            "amount": tx["amount"],  # Plaid: positive = money left account
            "hint":   pfc_hint,
        })

    prompt = (
        f"Categorize these bank transactions for a personal finance app.\n\n"
        f"Expense categories: {expense_cats}\n"
        f"Income categories: {income_cats}\n\n"
        f"Transactions (each has: id, merchant name, amount, plaid category hint):\n"
        f"{json.dumps(tx_items)}\n\n"
        "Return ONLY a JSON array — one object per transaction in the same order:\n"
        '[{"id":"...","is_transfer":false,"category":"Gas","type":"expense"}, ...]\n\n'
        "Rules:\n"
        "- is_transfer=true for: bank-to-bank transfers, credit card payments, loan repayments between own accounts\n"
        "- Trust the merchant name over the plaid hint for precision (e.g. Shell/BP/Exxon → Gas, Planet Fitness/climbing gym/yoga → the fitness/health category)\n"
        "- Always prefer an existing category name; only create a new short clean name (e.g. 'Pet Care', 'Gym & Fitness') when none of the existing ones fit\n"
        "- type is 'expense' or 'income'\n"
        "- Positive Plaid amount = money left the account (expense); negative = money came in (income)"
    )

    try:
        client = _anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text.strip()
        if raw.startswith("```"):
            raw = re.sub(r"```(?:json)?", "", raw).strip().strip("`").strip()
        results: list[dict] = json.loads(raw)
    except Exception as e:
        print(f"[AI categorize error] {e}")
        return {}

    output: dict[str, dict] = {}
    for item in results:
        tx_id = item.get("id")
        if not tx_id:
            continue

        if item.get("is_transfer"):
            output[tx_id] = {"is_transfer": True, "category_id": None}
            continue

        cat_name: str | None = item.get("category")
        cat_type: str = item.get("type", "expense")
        cat_id: int | None = None

        if cat_name:
            existing = db.query(Category).filter(
                Category.name == cat_name,
                (Category.user_id == user_id) | (Category.user_id.is_(None)),
            ).first()
            if existing:
                cat_id = existing.id
            else:
                new_cat = Category(
                    user_id=user_id,
                    name=cat_name,
                    type=cat_type,
                    color="#5b8fff",
                    is_system=False,
                )
                db.add(new_cat)
                db.flush()
                cat_id = new_cat.id

        output[tx_id] = {"is_transfer": False, "category_id": cat_id}

    return output


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

    # Fetch all Plaid accounts once — map plaid_account_id → (name, current_balance, subtype)
    accounts_data = _plaid_post("/accounts/get", {"access_token": item.access_token})
    plaid_acct_map: dict[str, str] = {}
    plaid_acct_balances: dict[str, tuple[float, str]] = {}
    for acct in accounts_data.get("accounts", []):
        name = acct.get("official_name") or acct.get("name") or "Unknown"
        plaid_acct_map[acct["account_id"]] = name
        balance = float(acct["balances"].get("current") or 0)
        subtype = (acct.get("subtype") or "other").lower()
        plaid_acct_balances[name] = (balance, subtype)

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

    # Pass 1: collect all transactions that pass transfer/dedup filters
    pending: list[tuple] = []  # (tx_dict, account, plaid_tx_id, tx_name, tx_amount, tx_date)

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

            if _is_internal_transfer(tx):
                continue

            # Dedup by plaid_tx_id (DB unique constraint is the final safety net)
            if db.query(Transaction).filter(Transaction.plaid_tx_id == plaid_tx_id).first():
                continue

            tx_name   = tx.get("merchant_name") or tx.get("name") or "Transaction"
            tx_amount = -float(tx["amount"])
            tx_date   = date.fromisoformat(tx["date"])

            pending.append((tx, account, plaid_tx_id, tx_name, tx_amount, tx_date))

        cursor = data.get("next_cursor", cursor)
        item.cursor = cursor

        if not data.get("has_more", False):
            break

    # Pass 2: AI categorizes ALL transactions in batches of 50
    ai_results: dict[str, dict] = {}
    all_txs = [tx for (tx, *_) in pending]
    for i in range(0, len(all_txs), 50):
        ai_results.update(_ai_categorize_batch(all_txs[i:i + 50], user_id, db))

    # Pass 3: insert transactions with AI-assigned categories
    for (tx, account, plaid_tx_id, tx_name, tx_amount, tx_date) in pending:
        ai = ai_results.get(plaid_tx_id, {})
        if ai.get("is_transfer"):
            continue  # AI caught a transfer the rule-based check missed
        category_id = ai.get("category_id")

        try:
            db.add(Transaction(
                user_id=user_id,
                account_id=account.id,
                category_id=category_id,
                amount=tx_amount,
                description=tx_name,
                plaid_tx_id=plaid_tx_id,
                transaction_date=tx_date,
            ))
            db.flush()
            added_count += 1
        except Exception:
            db.rollback()

    # Overwrite local balances with Plaid's actual current balance — single source of truth
    for name, (balance, subtype) in plaid_acct_balances.items():
        local_acct = local_acct_cache.get(name) or db.query(Account).filter(
            Account.user_id == user_id, Account.name == name
        ).first()
        if local_acct:
            local_acct.balance = Decimal(str(-abs(balance) if subtype in ("credit card", "credit") else balance))

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
PLAID_WEBHOOK_URL = os.getenv("PLAID_WEBHOOK_URL", "")


@router.post("/link-token")
def create_link_token(current_user: User = Depends(get_current_user)):
    body: dict = {
        "user": {"client_user_id": str(current_user.id)},
        "client_name": "Financial Tracker",
        "products": ["transactions"],
        "country_codes": ["US"],
        "language": "en",
        "transactions": {"days_requested": 90},
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
    # Delete all Plaid-tagged transactions and reverse their balance impact
    plaid_txs = db.query(Transaction).filter(
        Transaction.user_id == current_user.id,
        Transaction.plaid_tx_id.isnot(None),
    ).all()
    deleted_count = len(plaid_txs)
    for tx in plaid_txs:
        acct = db.query(Account).filter(Account.id == tx.account_id).first()
        if acct:
            acct.balance = Account.balance - Decimal(str(tx.amount))
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


PLAID_WEBHOOK_SECRET = os.getenv("PLAID_WEBHOOK_SECRET", "")


def _verify_plaid_webhook(body: bytes, headers: dict) -> bool:
    """Verify Plaid webhook signature. Skip verification if secret not configured."""
    if not PLAID_WEBHOOK_SECRET:
        return True
    sig = headers.get("plaid-verification") or headers.get("Plaid-Verification") or ""
    expected = hmac.new(PLAID_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)


@router.post("/webhook")
async def plaid_webhook(request: Request, background: BackgroundTasks):
    body = await request.body()
    if not _verify_plaid_webhook(body, dict(request.headers)):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    payload = json.loads(body)
    webhook_type = payload.get("webhook_type", "")
    webhook_code = payload.get("webhook_code", "")
    item_id      = payload.get("item_id", "")

    if webhook_type == "TRANSACTIONS" and webhook_code in ("SYNC_UPDATES_AVAILABLE", "DEFAULT_UPDATE", "INITIAL_UPDATE", "HISTORICAL_UPDATE"):
        db = SessionLocal()
        try:
            item = db.query(PlaidItem).filter(PlaidItem.item_id == item_id).first()
            if item:
                background.add_task(_do_sync_and_notify, item.id, item.user_id)
        finally:
            db.close()

    return {"status": "ok"}
