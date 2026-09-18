"""Account lifecycle: take your data with you, or leave entirely.

Two things a person must be able to do without asking anyone:

* **Export** everything Fintrack holds about them — as JSON (every table,
  every field the API exposes) and as a CSV of transactions for a spreadsheet.
* **Delete** the account. Bank connections are removed at Plaid first
  (best effort, because a live Item at Plaid after the person is gone is
  the worse failure), push subscriptions and every row cascade with the user,
  and the session cookies are cleared. The password is required so a stolen
  cookie cannot destroy an account.
"""

from __future__ import annotations

import csv
import io
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models.auth import AuthFailure, User
from models.database import (
    Account,
    Asset,
    Budget,
    CategorizationRule,
    AssistantConversation,
    AssistantMemory,
    AssistantMessage,
    Category,
    Loan,
    RecurringTransaction,
    SavingsGoal,
    SavingsGoalAllocation,
    Transaction,
    Transfer,
    UserPreferences,
    get_db,
)
from models.push import PushSubscription
from routers import plaid_router
from routers.plaid_router.models import PlaidItem
from utils.auth import clear_auth_cookies, get_current_user, verify_password
from utils.limiter import limiter
from utils.logging import get_logger, kv

router = APIRouter(prefix="/account", tags=["account"])
logger = get_logger(__name__)

EXPORT_VERSION = 1


def _plain(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _rows(query, columns: tuple[str, ...]) -> list[dict]:
    return [{name: _plain(getattr(row, name)) for name in columns} for row in query]


def build_export(db: Session, user: User) -> dict:
    """Everything, as plain JSON. Money as decimal strings, dates as ISO."""
    uid = user.id
    return {
        "export_version": EXPORT_VERSION,
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "user": {"id": user.id, "email": user.email, "username": user.username, "timezone": user.timezone, "created_at": _plain(user.created_at)},
        "accounts": _rows(
            db.query(Account).filter(Account.user_id == uid).order_by(Account.id),
            ("id", "name", "type", "balance", "credit_limit", "currency", "plaid_account_id", "created_at", "updated_at"),
        ),
        "categories": _rows(
            db.query(Category).filter(Category.user_id == uid).order_by(Category.id),
            ("id", "name", "type", "color", "is_system", "created_at"),
        ),
        "transactions": _rows(
            db.query(Transaction).filter(Transaction.user_id == uid).order_by(Transaction.transaction_date, Transaction.id),
            (
                "id", "account_id", "category_id", "amount", "description", "transaction_date", "plaid_tx_id",
                "plaid_merchant_name", "merchant_key", "category_source", "payment_channel", "iso_currency_code", "created_at",
            ),
        ),
        "transfers": _rows(
            db.query(Transfer).filter(Transfer.user_id == uid).order_by(Transfer.id),
            ("id", "from_account_id", "to_account_id", "amount", "note", "transfer_date", "created_at"),
        ),
        "assets": _rows(
            db.query(Asset).filter(Asset.user_id == uid).order_by(Asset.id),
            ("id", "name", "type", "asset_class", "quantity", "value_per_unit", "total_value", "currency", "purchase_date", "created_at"),
        ),
        "savings_goals": [
            {
                **row,
                "allocations": _rows(
                    db.query(SavingsGoalAllocation).filter(SavingsGoalAllocation.goal_id == row["id"]),
                    ("id", "account_id", "amount"),
                ),
            }
            for row in _rows(
                db.query(SavingsGoal).filter(SavingsGoal.user_id == uid).order_by(SavingsGoal.id),
                ("id", "name", "target_amount", "deadline", "created_at"),
            )
        ],
        "recurring": _rows(
            db.query(RecurringTransaction).filter(RecurringTransaction.user_id == uid).order_by(RecurringTransaction.id),
            ("id", "account_id", "category_id", "amount", "description", "period", "next_date", "is_active", "is_variable", "group_key", "source", "last_paid_date", "last_paid_amount", "created_at"),
        ),
        "loans": _rows(
            db.query(Loan).filter(Loan.user_id == uid).order_by(Loan.id),
            ("id", "borrower_name", "amount", "amount_repaid", "note", "loan_date", "due_date", "status", "created_at"),
        ),
        "bank_connections": _rows(
            db.query(PlaidItem).filter(PlaidItem.user_id == uid).order_by(PlaidItem.id),
            ("id", "institution_name", "created_at", "last_sync_at"),
        ),
        "assistant": {
            "memories": _rows(db.query(AssistantMemory).filter(AssistantMemory.user_id == uid).order_by(AssistantMemory.id), ("id", "content", "created_at")),
            "conversations": [
                {
                    **conv,
                    "messages": _rows(
                        db.query(AssistantMessage).filter(AssistantMessage.conversation_id == conv["id"]).order_by(AssistantMessage.id),
                        ("role", "content", "created_at"),
                    ),
                }
                for conv in _rows(
                    db.query(AssistantConversation).filter(AssistantConversation.user_id == uid).order_by(AssistantConversation.id),
                    ("id", "title", "created_at", "updated_at"),
                )
            ],
        },
        "preferences": _rows(
            db.query(UserPreferences).filter(UserPreferences.user_id == uid),
            ("automatic_categorization_enabled", "bill_reminders_enabled", "budget_alerts_enabled", "low_balance_alerts_enabled", "low_balance_threshold"),
        ),
        "budgets": _rows(
            db.query(Budget).filter(Budget.user_id == uid).order_by(Budget.id),
            ("id", "category_id", "amount", "rollover", "starts_on", "is_active", "created_at"),
        ),
        "categorization_rules": _rows(
            db.query(CategorizationRule).filter(CategorizationRule.user_id == uid).order_by(CategorizationRule.priority, CategorizationRule.id),
            ("id", "category_id", "field", "match_type", "pattern", "priority", "is_active", "applied_count", "created_at"),
        ),
    }


@router.get("/export")
@limiter.limit("10/hour")
def export_json(request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    payload = build_export(db, current_user)
    logger.info("account_export %s", kv(user_id=current_user.id, format="json"))
    stamp = date.today().isoformat()
    return Response(
        content=__import__("json").dumps(payload, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="fintrack-export-{stamp}.json"'},
    )


@router.get("/export/transactions.csv")
@limiter.limit("10/hour")
def export_transactions_csv(request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    accounts = {a.id: a.name for a in db.query(Account).filter(Account.user_id == current_user.id)}
    categories = {c.id: c.name for c in db.query(Category).filter(Category.user_id == current_user.id)}
    rows = (
        db.query(Transaction)
        .filter(Transaction.user_id == current_user.id)
        .order_by(Transaction.transaction_date, Transaction.id)
        .all()
    )
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["date", "account", "category", "amount", "description", "merchant", "source"])
    for row in rows:
        writer.writerow([
            row.transaction_date.isoformat(),
            accounts.get(row.account_id, ""),
            categories.get(row.category_id, "") if row.category_id else "",
            str(row.amount),
            _csv_safe(row.description or ""),
            _csv_safe(row.plaid_merchant_name or ""),
            "bank" if row.plaid_tx_id else "manual",
        ])
    logger.info("account_export %s", kv(user_id=current_user.id, format="csv", rows=len(rows)))
    stamp = date.today().isoformat()
    return StreamingResponse(
        iter(["﻿" + buffer.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="fintrack-transactions-{stamp}.csv"'},
    )


def _csv_safe(value: str) -> str:
    """Neutralise spreadsheet formula injection (`=`, `+`, `-`, `@`, tab, CR)."""
    if value and value[0] in "=+-@\t\r":
        return "'" + value
    return value


class DeleteAccountRequest(BaseModel):
    password: str = Field(min_length=1, max_length=256)
    # The client asks the person to type this; the server checks it too so a
    # replayed request body cannot delete an account by accident.
    confirmation: str = Field(min_length=1, max_length=64)


@router.post("/delete", status_code=200)
@limiter.limit("3/hour")
def delete_account(
    request: Request,
    body: DeleteAccountRequest,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if body.confirmation.strip().upper() != "DELETE":
        raise HTTPException(status_code=400, detail='Type DELETE to confirm.')
    if not verify_password(body.password, current_user.hashed_password):
        raise HTTPException(status_code=403, detail="Password is incorrect.")

    # 1. Bank connections at Plaid, best effort. A failure is logged, counted
    #    and reported, but does not keep the person's data hostage.
    items = db.query(PlaidItem).filter(PlaidItem.user_id == current_user.id).all()
    unremoved = 0
    for item in items:
        try:
            plaid_router._plaid_post("/item/remove", {"access_token": plaid_router._item_access_token(db, item)})
        except plaid_router.PlaidItemNotFound:
            pass
        except Exception as exc:
            unremoved += 1
            logger.error(
                "account_delete_plaid_remove_failed %s",
                kv(user_id=current_user.id, item_id=item.id, error_type=type(exc).__name__),
            )

    # 2. Everything else cascades from the user row. Lockout counters are
    #    keyed by identifier, not by user, so they are cleared explicitly.
    user_id, email, username = current_user.id, current_user.email, current_user.username
    push_count = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).count()
    db.query(AuthFailure).filter(AuthFailure.identifier.in_([email.lower(), username.lower()])).delete(synchronize_session=False)
    db.delete(current_user)
    db.commit()

    clear_auth_cookies(response)
    logger.info(
        "account_deleted %s",
        kv(user_id=user_id, plaid_items=len(items), plaid_unremoved=unremoved, push_subscriptions=push_count),
    )
    return {
        "deleted": True,
        "bank_connections_removed": len(items) - unremoved,
        "bank_connections_unremoved": unremoved,
    }
