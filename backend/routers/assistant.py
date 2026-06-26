"""AI financial assistant — a chat agent over the user's data with persistent memory.

Design:
- Model: Claude Haiku 4.5 (cheap, fast, capable of tool use).
- Read tools execute immediately against the signed-in user's data.
- Write tools never touch the DB inside the chat loop. They are returned to the
  client as "pending actions" and only run when the user confirms via /execute.
- Memory is real: the model writes durable facts with `save_memory`, and every
  chat injects the stored memories + a live financial snapshot into the system
  prompt — the assistant's persistent notebook.
"""

import json
import os
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from models.auth import User
from models.database import (
    Account,
    AssistantConversation,
    AssistantMemory,
    AssistantMessage,
    Asset,
    Category,
    Loan,
    RecurringTransaction,
    SavingsGoal,
    Transaction,
    get_db,
)
from utils.auth import get_current_user
from utils.logging import get_logger, kv

router = APIRouter(prefix="/assistant", tags=["assistant"])
logger = get_logger(__name__)

MODEL = "claude-haiku-4-5"
MAX_TOKENS = 2048
MAX_TOOL_ITERATIONS = 8
MAX_HISTORY_MESSAGES = 30


# ─── JSON helpers ────────────────────────────────────────────────────────────
def _jsonable(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _dump(obj) -> str:
    return json.dumps(obj, default=_jsonable)


def _num(value) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid number: {value!r}")


def _parse_date(value) -> Optional[date]:
    """Tool inputs arrive as ISO strings; SQLAlchemy Date columns need date objects."""
    if value in (None, ""):
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date (expected YYYY-MM-DD): {value!r}")


# ─── Read-tool implementations (execute immediately) ─────────────────────────
def _t_get_overview(db: Session, user: User, **_) -> dict:
    accounts = db.query(Account).filter(Account.user_id == user.id).all()
    liquid = sum((a.balance for a in accounts if a.type != "credit_card"), Decimal("0"))
    credit = sum((a.balance for a in accounts if a.type == "credit_card"), Decimal("0"))
    assets_total = db.query(func.coalesce(func.sum(Asset.total_value), 0)).filter(Asset.user_id == user.id).scalar()
    loans_out = (
        db.query(func.coalesce(func.sum(Loan.amount - Loan.amount_repaid), 0))
        .filter(Loan.user_id == user.id, Loan.status == "active")
        .scalar()
    )
    return {
        "liquid_balance": _jsonable(liquid),
        "credit_card_balance": _jsonable(credit),
        "assets_total": _jsonable(assets_total),
        "loans_owed_to_you": _jsonable(loans_out),
        "estimated_net_worth": _jsonable(liquid + Decimal(str(assets_total)) + Decimal(str(loans_out))),
        "account_count": len(accounts),
    }


def _t_list_accounts(db: Session, user: User, **_) -> list:
    rows = db.query(Account).filter(Account.user_id == user.id).order_by(Account.created_at).all()
    return [
        {"id": a.id, "name": a.name, "type": a.type, "balance": _jsonable(a.balance), "currency": a.currency}
        for a in rows
    ]


def _t_list_transactions(
    db: Session,
    user: User,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    type: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 25,
    **_,
) -> list:
    q = db.query(Transaction).filter(Transaction.user_id == user.id)
    if date_from:
        q = q.filter(Transaction.transaction_date >= _parse_date(date_from))
    if date_to:
        q = q.filter(Transaction.transaction_date <= _parse_date(date_to))
    if type == "income":
        q = q.filter(Transaction.amount > 0)
    elif type == "expense":
        q = q.filter(Transaction.amount < 0)
    if search:
        q = q.filter(Transaction.description.ilike(f"%{search}%"))
    rows = q.order_by(Transaction.transaction_date.desc(), Transaction.id.desc()).limit(min(int(limit), 100)).all()
    return [
        {
            "id": t.id,
            "date": _jsonable(t.transaction_date),
            "amount": _jsonable(t.amount),
            "description": t.description,
            "account_id": t.account_id,
            "category_id": t.category_id,
        }
        for t in rows
    ]


def _t_spending_by_category(db: Session, user: User, date_from: Optional[str] = None, date_to: Optional[str] = None, **_) -> list:
    q = (
        db.query(Category.name, func.sum(func.abs(Transaction.amount)).label("total"))
        .join(Category, Category.id == Transaction.category_id, isouter=True)
        .filter(Transaction.user_id == user.id, Transaction.amount < 0)
    )
    if date_from:
        q = q.filter(Transaction.transaction_date >= _parse_date(date_from))
    if date_to:
        q = q.filter(Transaction.transaction_date <= _parse_date(date_to))
    rows = q.group_by(Category.name).order_by(func.sum(func.abs(Transaction.amount)).desc()).all()
    return [{"category": name or "Uncategorized", "total_spent": _jsonable(total)} for name, total in rows]


def _t_list_recurring(db: Session, user: User, **_) -> list:
    rows = db.query(RecurringTransaction).filter(RecurringTransaction.user_id == user.id, RecurringTransaction.is_active.is_(True)).all()
    return [
        {
            "id": r.id,
            "description": r.description,
            "amount": _jsonable(r.amount),
            "period": r.period,
            "next_date": _jsonable(r.next_date),
            "is_variable": r.is_variable,
        }
        for r in rows
    ]


def _t_list_savings_goals(db: Session, user: User, **_) -> list:
    rows = db.query(SavingsGoal).filter(SavingsGoal.user_id == user.id).all()
    out = []
    for g in rows:
        saved = sum((a.amount for a in g.allocations), Decimal("0"))
        out.append(
            {
                "id": g.id,
                "name": g.name,
                "target_amount": _jsonable(g.target_amount),
                "saved": _jsonable(saved),
                "deadline": _jsonable(g.deadline),
            }
        )
    return out


def _t_list_loans(db: Session, user: User, **_) -> list:
    rows = db.query(Loan).filter(Loan.user_id == user.id).all()
    return [
        {
            "id": l.id,
            "borrower_name": l.borrower_name,
            "amount": _jsonable(l.amount),
            "amount_repaid": _jsonable(l.amount_repaid),
            "status": l.status,
            "due_date": _jsonable(l.due_date),
        }
        for l in rows
    ]


def _t_list_assets(db: Session, user: User, **_) -> list:
    rows = db.query(Asset).filter(Asset.user_id == user.id).all()
    return [
        {"id": a.id, "name": a.name, "type": a.type, "asset_class": a.asset_class, "total_value": _jsonable(a.total_value)}
        for a in rows
    ]


def _t_save_memory(db: Session, user: User, content: str = "", **_) -> dict:
    content = (content or "").strip()
    if not content:
        return {"saved": False, "reason": "empty"}
    db.add(AssistantMemory(user_id=user.id, content=content[:2000]))
    db.commit()
    return {"saved": True}


READ_TOOLS = {
    "get_overview": _t_get_overview,
    "list_accounts": _t_list_accounts,
    "list_transactions": _t_list_transactions,
    "spending_by_category": _t_spending_by_category,
    "list_recurring": _t_list_recurring,
    "list_savings_goals": _t_list_savings_goals,
    "list_loans": _t_list_loans,
    "list_assets": _t_list_assets,
    "save_memory": _t_save_memory,
}

WRITE_TOOLS = {"add_transaction", "add_account", "add_savings_goal", "add_loan"}


# ─── Tool schemas sent to Claude ─────────────────────────────────────────────
def _tool_schemas() -> list:
    return [
        {
            "name": "get_overview",
            "description": "Get a snapshot of the user's finances: liquid balance, credit card debt, assets, loans owed, and estimated net worth.",
            "input_schema": {"type": "object", "properties": {}},
        },
        {
            "name": "list_accounts",
            "description": "List all of the user's accounts with their balances. Use this to find an account_id before proposing a transaction.",
            "input_schema": {"type": "object", "properties": {}},
        },
        {
            "name": "list_transactions",
            "description": "List recent transactions. Negative amounts are expenses, positive are income.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "date_from": {"type": "string", "description": "ISO date YYYY-MM-DD (inclusive)"},
                    "date_to": {"type": "string", "description": "ISO date YYYY-MM-DD (inclusive)"},
                    "type": {"type": "string", "enum": ["income", "expense"]},
                    "search": {"type": "string", "description": "Text to match in the description"},
                    "limit": {"type": "integer", "description": "Max rows (default 25, max 100)"},
                },
            },
        },
        {
            "name": "spending_by_category",
            "description": "Total expenses grouped by category over an optional date range.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "date_from": {"type": "string"},
                    "date_to": {"type": "string"},
                },
            },
        },
        {"name": "list_recurring", "description": "List active recurring transactions (subscriptions, salary, bills).", "input_schema": {"type": "object", "properties": {}}},
        {"name": "list_savings_goals", "description": "List savings goals with target and saved amounts.", "input_schema": {"type": "object", "properties": {}}},
        {"name": "list_loans", "description": "List money the user has lent out and repayment status.", "input_schema": {"type": "object", "properties": {}}},
        {"name": "list_assets", "description": "List the user's assets (physical and investment).", "input_schema": {"type": "object", "properties": {}}},
        {
            "name": "save_memory",
            "description": "Save a durable fact about the user that should be remembered across all future chats — goals, preferences, habits, rules, recurring context. Use this whenever you learn something lasting. This is your persistent notebook.",
            "input_schema": {
                "type": "object",
                "properties": {"content": {"type": "string", "description": "A single concise fact to remember."}},
                "required": ["content"],
            },
        },
        {
            "name": "add_transaction",
            "description": "Propose recording a transaction. This is NOT executed automatically — it is shown to the user for confirmation. Always call list_accounts first to get a valid account_id.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "account_id": {"type": "integer"},
                    "amount": {"type": "number", "description": "Positive number; use 'direction' to indicate income vs expense."},
                    "direction": {"type": "string", "enum": ["income", "expense"]},
                    "description": {"type": "string"},
                    "transaction_date": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                    "category": {"type": "string", "description": "Optional category name to match."},
                },
                "required": ["account_id", "amount", "direction", "transaction_date"],
            },
        },
        {
            "name": "add_account",
            "description": "Propose creating a new account. Shown to the user for confirmation; not executed automatically.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "type": {"type": "string", "enum": ["checking", "savings", "credit_card", "cash", "investment"]},
                    "balance": {"type": "number"},
                },
                "required": ["name", "type"],
            },
        },
        {
            "name": "add_savings_goal",
            "description": "Propose creating a savings goal. Shown to the user for confirmation; not executed automatically.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "target_amount": {"type": "number"},
                    "deadline": {"type": "string", "description": "Optional ISO date YYYY-MM-DD"},
                },
                "required": ["name", "target_amount"],
            },
        },
        {
            "name": "add_loan",
            "description": "Propose recording money lent to someone. Shown to the user for confirmation; not executed automatically.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "borrower_name": {"type": "string"},
                    "amount": {"type": "number"},
                    "loan_date": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                    "due_date": {"type": "string", "description": "Optional ISO date YYYY-MM-DD"},
                    "note": {"type": "string"},
                },
                "required": ["borrower_name", "amount", "loan_date"],
            },
        },
    ]


def _action_summary(tool: str, inp: dict) -> str:
    if tool == "add_transaction":
        sign = "income" if inp.get("direction") == "income" else "expense"
        return f"Record {sign} of {inp.get('amount')} — \"{inp.get('description') or 'No note'}\" on {inp.get('transaction_date')}"
    if tool == "add_account":
        return f"Create {inp.get('type')} account \"{inp.get('name')}\" with balance {inp.get('balance', 0)}"
    if tool == "add_savings_goal":
        return f"Create savings goal \"{inp.get('name')}\" targeting {inp.get('target_amount')}"
    if tool == "add_loan":
        return f"Record loan of {inp.get('amount')} to {inp.get('borrower_name')}"
    return tool


def _build_system_prompt(db: Session, user: User) -> str:
    today = date.today().isoformat()
    accounts = _t_list_accounts(db, user)
    overview = _t_get_overview(db, user)
    memories = (
        db.query(AssistantMemory)
        .filter(AssistantMemory.user_id == user.id)
        .order_by(AssistantMemory.created_at.desc())
        .limit(50)
        .all()
    )
    memory_block = "\n".join(f"- {m.content}" for m in memories) or "- (nothing yet)"

    return (
        "You are Fin, the user's personal financial assistant inside their Fintrack app. "
        "You are warm, sharp, and concise — like a trusted finance partner who sits beside them.\n\n"
        f"Today is {today}. Currency amounts are in the account's own currency (mostly USD).\n\n"
        "## How you work\n"
        "- You have READ access to all of the user's financial data via tools — use them to ground every answer in real numbers rather than guessing.\n"
        "- To CHANGE data (add a transaction, account, savings goal, or loan), call the matching `add_*` tool. These are NOT executed immediately — they are surfaced to the user as a confirmation card. Tell the user you've prepared it and ask them to confirm.\n"
        "- Never claim a change is done until the user confirms it. After proposing, stop and let them confirm.\n"
        "- When you learn a durable fact about the user (a goal, a habit, a preference, a rule), call `save_memory` so you remember it forever.\n"
        "- Be brief. Lead with the answer. Use plain text and short lists; no markdown tables.\n\n"
        "## Live financial snapshot\n"
        f"{_dump(overview)}\n"
        f"Accounts: {_dump(accounts)}\n\n"
        "## What you remember about this user\n"
        f"{memory_block}\n"
    )


# ─── Request / response models ───────────────────────────────────────────────
class ChatRequest(BaseModel):
    conversation_id: Optional[int] = None
    message: str


class ExecuteRequest(BaseModel):
    conversation_id: Optional[int] = None
    tool: str
    input: dict


# ─── Conversation helpers ────────────────────────────────────────────────────
def _get_conversation(db: Session, user: User, conversation_id: int) -> AssistantConversation:
    conv = (
        db.query(AssistantConversation)
        .filter(AssistantConversation.id == conversation_id, AssistantConversation.user_id == user.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


# ─── Endpoints ───────────────────────────────────────────────────────────────
@router.get("/conversations")
def list_conversations(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = (
        db.query(AssistantConversation)
        .filter(AssistantConversation.user_id == current_user.id)
        .order_by(AssistantConversation.updated_at.desc())
        .all()
    )
    return [{"id": c.id, "title": c.title, "updated_at": _jsonable(c.updated_at)} for c in rows]


@router.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    conv = _get_conversation(db, current_user, conversation_id)
    return {
        "id": conv.id,
        "title": conv.title,
        "messages": [
            {"role": m.role, "content": m.content, "created_at": _jsonable(m.created_at)} for m in conv.messages
        ],
    }


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(conversation_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    conv = _get_conversation(db, current_user, conversation_id)
    db.delete(conv)
    db.commit()


@router.get("/memories")
def list_memories(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = (
        db.query(AssistantMemory)
        .filter(AssistantMemory.user_id == current_user.id)
        .order_by(AssistantMemory.created_at.desc())
        .all()
    )
    return [{"id": m.id, "content": m.content, "created_at": _jsonable(m.created_at)} for m in rows]


@router.delete("/memories/{memory_id}", status_code=204)
def delete_memory(memory_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    m = db.query(AssistantMemory).filter(AssistantMemory.id == memory_id, AssistantMemory.user_id == current_user.id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Memory not found")
    db.delete(m)
    db.commit()


@router.post("/chat")
def chat(req: ChatRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    message = (req.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message is empty")

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="The AI assistant is not configured yet. Add an ANTHROPIC_API_KEY environment variable to enable it.",
        )

    try:
        import anthropic
    except ImportError:
        raise HTTPException(status_code=503, detail="The anthropic package is not installed on the server.")

    # Resolve / create conversation
    if req.conversation_id:
        conv = _get_conversation(db, current_user, req.conversation_id)
    else:
        conv = AssistantConversation(user_id=current_user.id, title=message[:60])
        db.add(conv)
        db.commit()
        db.refresh(conv)

    # Build the message history for the API from stored turns
    history = (
        db.query(AssistantMessage)
        .filter(AssistantMessage.conversation_id == conv.id)
        .order_by(AssistantMessage.id.desc())
        .limit(MAX_HISTORY_MESSAGES)
        .all()
    )
    history = list(reversed(history))
    api_messages = [{"role": m.role, "content": m.content} for m in history]
    api_messages.append({"role": "user", "content": message})

    system_prompt = _build_system_prompt(db, current_user)
    tools = _tool_schemas()
    pending_actions: list[dict] = []

    client = anthropic.Anthropic(api_key=api_key)
    response = None
    try:
        for _ in range(MAX_TOOL_ITERATIONS):
            response = client.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=system_prompt,
                tools=tools,
                messages=api_messages,
            )
            if response.stop_reason != "tool_use":
                break

            api_messages.append({"role": "assistant", "content": response.content})
            tool_results = []
            for block in response.content:
                if block.type != "tool_use":
                    continue
                name, tool_input = block.name, dict(block.input or {})
                if name in WRITE_TOOLS:
                    pending_actions.append(
                        {"tool": name, "input": tool_input, "summary": _action_summary(name, tool_input)}
                    )
                    result_str = (
                        "Proposed and surfaced to the user for confirmation. It is NOT executed yet — "
                        "do not say it is done. Briefly tell the user what you prepared and ask them to confirm."
                    )
                elif name in READ_TOOLS:
                    try:
                        result_str = _dump(READ_TOOLS[name](db, current_user, **tool_input))
                    except HTTPException as exc:
                        result_str = _dump({"error": exc.detail})
                else:
                    result_str = _dump({"error": f"Unknown tool {name}"})
                tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": result_str})
            api_messages.append({"role": "user", "content": tool_results})
    except anthropic.APIError as exc:
        logger.warning("assistant_api_error %s", kv(error=str(exc), user_id=current_user.id))
        raise HTTPException(status_code=502, detail="The AI service returned an error. Please try again.")

    reply = "".join(getattr(b, "text", "") for b in response.content if b.type == "text").strip()
    if not reply:
        reply = "Done." if pending_actions else "I'm not sure how to help with that — could you rephrase?"

    # Persist this turn (user message + assistant reply text only)
    db.add(AssistantMessage(conversation_id=conv.id, user_id=current_user.id, role="user", content=message))
    db.add(AssistantMessage(conversation_id=conv.id, user_id=current_user.id, role="assistant", content=reply))
    conv.updated_at = datetime.utcnow()
    db.commit()

    return {
        "conversation_id": conv.id,
        "title": conv.title,
        "reply": reply,
        "pending_actions": pending_actions,
    }


@router.post("/execute")
def execute_action(req: ExecuteRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Run a write action the user has confirmed."""
    tool, inp = req.tool, req.input or {}
    if tool not in WRITE_TOOLS:
        raise HTTPException(status_code=400, detail=f"'{tool}' is not an executable action")

    if tool == "add_transaction":
        account = db.query(Account).filter(Account.id == inp.get("account_id"), Account.user_id == current_user.id).first()
        if not account:
            raise HTTPException(status_code=404, detail="Account not found")
        amount = abs(_num(inp.get("amount")))
        signed = amount if inp.get("direction") == "income" else -amount
        category_id = None
        if inp.get("category"):
            cat = (
                db.query(Category)
                .filter(func.lower(Category.name) == str(inp["category"]).lower())
                .filter((Category.user_id == current_user.id) | (Category.user_id.is_(None)))
                .first()
            )
            category_id = cat.id if cat else None
        tx_date = _parse_date(inp.get("transaction_date"))
        if tx_date is None:
            raise HTTPException(status_code=400, detail="transaction_date is required")
        tx = Transaction(
            user_id=current_user.id,
            account_id=account.id,
            category_id=category_id,
            amount=signed,
            description=inp.get("description"),
            transaction_date=tx_date,
        )
        db.add(tx)
        account.balance = Account.balance + signed
        db.commit()
        message = "Transaction recorded."

    elif tool == "add_account":
        acc = Account(
            user_id=current_user.id,
            name=inp.get("name"),
            type=inp.get("type"),
            balance=_num(inp.get("balance", 0)),
        )
        db.add(acc)
        db.commit()
        message = "Account created."

    elif tool == "add_savings_goal":
        goal = SavingsGoal(
            user_id=current_user.id,
            name=inp.get("name"),
            target_amount=_num(inp.get("target_amount")),
            deadline=_parse_date(inp.get("deadline")),
        )
        db.add(goal)
        db.commit()
        message = "Savings goal created."

    elif tool == "add_loan":
        loan = Loan(
            user_id=current_user.id,
            borrower_name=inp.get("borrower_name"),
            amount=_num(inp.get("amount")),
            note=inp.get("note"),
            loan_date=_parse_date(inp.get("loan_date")) or date.today(),
            due_date=_parse_date(inp.get("due_date")),
        )
        db.add(loan)
        db.commit()
        message = "Loan recorded."

    else:  # pragma: no cover
        raise HTTPException(status_code=400, detail="Unsupported action")

    # Leave a breadcrumb in the conversation so follow-up turns have context.
    if req.conversation_id:
        conv = _get_conversation(db, current_user, req.conversation_id)
        db.add(
            AssistantMessage(
                conversation_id=conv.id,
                user_id=current_user.id,
                role="user",
                content=f"[Confirmed] {_action_summary(tool, inp)}",
            )
        )
        conv.updated_at = datetime.utcnow()
        db.commit()

    return {"success": True, "message": message}
