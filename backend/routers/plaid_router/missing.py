"""Bank rows the ledger is missing: card payments and transfers that were deleted.

The owner deleted card payments and moves between their own accounts after
import, because back then a transfer counted as spending on one side and as
income on the other. Totals came out right and every account's history came
out wrong: with no payments in the ledger, a card "owed" thousands less six
months ago than it does today, and checking walked back to −$14k in May.

Transfers now have a category type of their own, which never counts as income
or spending (`services/classification.py`), so these rows can come back
safely. This asks each bank for its whole history (a `/transactions/sync` from
the beginning, read-only: no cursor is stored and nothing is written) and
offers the posted rows the ledger does not have that look like money moving
between accounts: Plaid files them as transfers or loan payments, or they are
a credit to a card. The owner picks; the picked rows are added under the
Transfer category. Balances are not touched, since a bank account's balance
comes from the bank and these rows are history.

Other missing rows are not offered. A deleted purchase was most likely a
duplicate, and bringing it back would count it twice.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.auth import User
from models.database import Account, Transaction, get_db
from routers import plaid_router as facade
from routers.plaid_router import MAX_PAGINATION_RESTARTS, PlaidMutationDuringPagination
from routers.plaid_router.models import PlaidItem
from routers.plaid_router.sync import _plaid_amount, _plaid_description, _posted_row
from services.balance_snapshots import refresh_snapshots_for_user
from services.transfer_suggestions import transfer_category
from utils.auth import get_current_user
from utils.dates import user_today
from utils.limiter import limiter
from utils.logging import get_logger, kv

router = APIRouter()
logger = get_logger(__name__)

TRANSFER_CATEGORIES = {"TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"}


@dataclass
class MissingRow:
    plaid_tx_id: str
    account: Account
    on: date
    amount: Decimal
    description: str
    raw: dict


class MissingRowOut(BaseModel):
    plaid_transaction_id: str
    account_id: int
    account_name: str
    date: date
    amount: Decimal
    description: str


class MissingTransfersOut(BaseModel):
    rows: list[MissingRowOut]
    # Banks that could not be asked (a login to repair, Plaid down). Their rows
    # are not in `rows`, and the screen says so rather than implying none.
    unavailable: list[str]


class RestoreIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=2000)


class RestoreOut(BaseModel):
    restored: int


def _bank_history(db: Session, item: PlaidItem) -> list[dict]:
    """Every transaction the bank will give for this Item, without storing a cursor."""
    token = facade._item_access_token(db, item)
    rows: list[dict] = []
    cursor = ""
    restarts = 0
    while True:
        body: dict = {"access_token": token, "count": 500}
        if cursor:
            body["cursor"] = cursor
        try:
            data = facade._plaid_post("/transactions/sync", body)
        except PlaidMutationDuringPagination:
            restarts += 1
            if restarts > MAX_PAGINATION_RESTARTS:
                raise
            rows, cursor = [], ""
            continue
        rows.extend(data.get("added", []))
        rows.extend(data.get("modified", []))
        cursor = data.get("next_cursor") or ""
        if not data.get("has_more"):
            return rows


def _looks_like_transfer(tx: dict, account: Account) -> bool:
    category = (tx.get("personal_finance_category") or {}).get("primary")
    if category in TRANSFER_CATEGORIES:
        return True
    # A credit to a card is a payment (or a refund, which the owner can untick).
    return account.type == "credit_card" and _plaid_amount(tx) > 0


def missing_transfers(db: Session, user_id: int) -> tuple[list[MissingRow], list[str]]:
    """Transfer-like posted rows the banks have and the ledger does not, newest first."""
    items = db.query(PlaidItem).filter(PlaidItem.user_id == user_id).order_by(PlaidItem.id).all()
    if not items:
        raise HTTPException(status_code=404, detail="No connected banks.")
    accounts = {
        a.plaid_account_id: a
        for a in db.query(Account).filter(Account.user_id == user_id, Account.plaid_account_id.isnot(None))
    }
    known = {
        tx_id
        for (tx_id,) in db.query(Transaction.plaid_tx_id).filter(
            Transaction.user_id == user_id, Transaction.plaid_tx_id.isnot(None),
        )
    }
    found: dict[str, MissingRow] = {}
    unavailable: list[str] = []
    for item in items:
        try:
            history = _bank_history(db, item)
        except (HTTPException, PlaidMutationDuringPagination) as error:
            logger.warning("missing_transfers_item_failed %s", kv(item_id=item.id, error=type(error).__name__))
            unavailable.append(item.institution_name or "A bank")
            continue
        for tx in history:
            tx_id = tx.get("transaction_id")
            if not tx_id or tx.get("pending") or tx_id in known or tx_id in found:
                continue
            if tx.get("pending_transaction_id") in known:
                continue
            account = accounts.get(tx.get("account_id"))
            if account is None or not _looks_like_transfer(tx, account):
                continue
            found[tx_id] = MissingRow(
                plaid_tx_id=tx_id,
                account=account,
                on=date.fromisoformat(tx["date"]),
                amount=_plaid_amount(tx),
                description=_plaid_description(tx),
                raw=tx,
            )
    rows = sorted(found.values(), key=lambda r: (r.on, r.plaid_tx_id), reverse=True)
    return rows, unavailable


@router.get("/missing-transfers", response_model=MissingTransfersOut)
@limiter.limit("10/minute")
def list_missing_transfers(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Card payments and transfers the banks have that the ledger does not. Read-only."""
    del request  # used by the rate limiter
    rows, unavailable = missing_transfers(db, current_user.id)
    db.commit()  # `_item_access_token` may re-encrypt a legacy token
    return MissingTransfersOut(
        rows=[
            MissingRowOut(
                plaid_transaction_id=r.plaid_tx_id,
                account_id=r.account.id,
                account_name=r.account.name,
                date=r.on,
                amount=r.amount,
                description=r.description,
            )
            for r in rows
        ],
        unavailable=unavailable,
    )


@router.post("/missing-transfers/restore", response_model=RestoreOut)
@limiter.limit("10/minute")
def restore_missing_transfers(
    request: Request,
    body: RestoreIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add the chosen rows as Transfers.

    The rows are fetched from the bank again rather than taken from the
    request, so only a row the bank really has, and the ledger really lacks,
    can be added. An id that is not (or no longer) missing is ignored.
    """
    del request  # used by the rate limiter
    wanted = set(body.ids)
    rows, _ = missing_transfers(db, current_user.id)
    chosen = [r for r in rows if r.plaid_tx_id in wanted]
    category = transfer_category(db, current_user.id)
    for row in chosen:
        values = _posted_row(db, row.raw, current_user.id, row.account)
        values.update(category_id=category.id, category_source="user")
        db.add(Transaction(**values))
    try:
        db.commit()
    except IntegrityError:
        # A sync stored one of them in the meantime; nothing was added.
        db.rollback()
        raise HTTPException(status_code=409, detail="Your bank synced while restoring. Open the list again.")
    if chosen:
        refresh_snapshots_for_user(db, current_user.id, today=user_today(current_user))
    logger.info("missing_transfers_restored %s", kv(user_id=current_user.id, restored=len(chosen)))
    return RestoreOut(restored=len(chosen))
