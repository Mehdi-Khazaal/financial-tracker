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
import secrets
from collections import OrderedDict
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from threading import Lock
from time import monotonic
from typing import Optional
from zoneinfo import ZoneInfo, available_timezones

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError
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
    utc_now,
)
from utils.auth import get_current_user
from utils.logging import get_logger, kv
from utils.limiter import limiter

router = APIRouter(prefix="/assistant", tags=["assistant"])
logger = get_logger(__name__)

# Sonnet 5 with adaptive thinking: the assistant has to reason across the
# ledger, live market data, and projections, which Haiku cannot do at all.
MODEL = "claude-sonnet-5"
# Haiku carries the "quick" tier. It cannot think, and it does not support the
# effort parameter or the _20260209 web-search tool, so that tier is restricted
# to plain ledger lookups where none of that is needed.
FAST_MODEL = "claude-haiku-4-5"
MAX_TOKENS = 8000
EFFORT = "high"

# Thinking tokens dominate output cost, so depth is chosen per question rather
# than paying for deep reasoning on "what's my balance".
TIERS = {
    "quick": {"model": FAST_MODEL, "effort": None, "thinking": False},
    "standard": {"model": MODEL, "effort": "medium", "thinking": True},
    "deep": {"model": MODEL, "effort": "high", "thinking": True},
}

# USD per million tokens. Sonnet 5 input/output is the promotional rate that
# runs to 2026-08-31; it reverts to 3.00/15.00 after that, so update this then.
MODEL_PRICING = {
    "claude-sonnet-5": {"input": Decimal("2.00"), "output": Decimal("10.00")},
    "claude-haiku-4-5": {"input": Decimal("1.00"), "output": Decimal("5.00")},
}
# Cache reads are ~0.1x the input rate; writes carry a ~1.25x premium at the
# default 5-minute TTL. This is what makes the cached prefix worth the layout.
CACHE_READ_MULTIPLIER = Decimal("0.1")
CACHE_WRITE_MULTIPLIER = Decimal("1.25")
# Web search is metered per search, so cap it per turn.
WEB_SEARCH_MAX_USES = 6
# Server-side tools can hand back `pause_turn` when their own loop hits a
# limit; re-sending resumes it. Bounded so a wedged turn cannot spin.
MAX_PAUSE_RESUMES = 3
MAX_TOOL_ITERATIONS = 12
MAX_HISTORY_MESSAGES = 30
MAX_MESSAGE_CHARS = 4000
MAX_REPLY_CHARS = 12000
MAX_CONVERSATIONS = 100
MAX_STORED_MESSAGES = 200
MAX_LISTED_CONVERSATIONS = 100
PENDING_ACTION_TTL_SECONDS = 10 * 60
MAX_PENDING_ACTIONS = 2000

# A schema migration is intentionally avoided here. Pending confirmations are
# process-local, short-lived, unguessable, and consumed atomically on execute.
_pending_actions: OrderedDict[str, dict] = OrderedDict()
_pending_actions_lock = Lock()


# ─── Time ────────────────────────────────────────────────────────────────────
# The API process runs in UTC. Resolving "today" there is wrong for any user in
# another zone for part of every day, which is why the assistant used to report
# the wrong date. Everything user-facing resolves through the helpers below.
_VALID_ZONES = available_timezones()


def _clean_timezone(value) -> Optional[str]:
    """Accept only a real IANA zone name; anything else is ignored, not fatal."""
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    return candidate if candidate in _VALID_ZONES else None


def _user_now(user: User) -> datetime:
    zone_name = _clean_timezone(getattr(user, "timezone", None))
    if zone_name:
        return datetime.now(ZoneInfo(zone_name))
    return datetime.now(ZoneInfo("UTC"))


def _user_today(user: User) -> date:
    return _user_now(user).date()


# ─── JSON helpers ────────────────────────────────────────────────────────────
def _jsonable(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _dump(obj) -> str:
    return json.dumps(obj, default=_jsonable)


def _date_scope(tool_input: dict, *, as_of: Optional[date] = None) -> str:
    start = tool_input.get("date_from")
    end = tool_input.get("date_to")
    if start and end:
        return f"{start} to {end}"
    if start:
        return f"Since {start}"
    if end:
        return f"Through {end}"
    return f"As of {(as_of or date.today()).isoformat()}"


def _visual_block_for_tool(name: str, tool_input: dict, result, *, as_of: Optional[date] = None) -> Optional[dict]:
    """Turn trusted read-tool output into a small, client-renderable block."""
    source = "Fintrack ledger"
    scope = _date_scope(tool_input, as_of=as_of)

    if name == "get_overview" and isinstance(result, dict):
        metrics = [
            {"label": "Estimated net worth", "value": result.get("estimated_net_worth", 0), "format": "currency"},
            {"label": "Liquid balance", "value": result.get("liquid_balance", 0), "format": "currency"},
            {"label": "Assets", "value": result.get("assets_total", 0), "format": "currency"},
            {"label": "Credit cards", "value": result.get("credit_card_balance", 0), "format": "currency"},
        ]
        return {"type": "metric_grid", "title": "Financial position", "scope": scope, "source": source, "metrics": metrics}

    if name == "spending_by_category" and isinstance(result, list):
        total = sum(float(row.get("total_spent") or 0) for row in result)
        rows = [
            {
                "label": str(row.get("category") or "Uncategorized"),
                "value": float(row.get("total_spent") or 0),
                "share": (float(row.get("total_spent") or 0) / total) if total else 0,
            }
            for row in result[:8]
        ]
        return {"type": "category_breakdown", "title": "Spending by category", "scope": scope, "source": source, "total": total, "rows": rows}

    if name == "list_transactions" and isinstance(result, list):
        rows = [
            {
                "id": row.get("id"),
                "label": row.get("description") or "Transaction",
                "date": row.get("date"),
                "value": float(row.get("amount") or 0),
            }
            for row in result[:10]
        ]
        return {"type": "transaction_list", "title": "Transactions", "scope": scope, "source": source, "rows": rows}

    if name == "cashflow_trend" and isinstance(result, list):
        scope = f"Last {len(result)} months through {(as_of or date.today()).isoformat()}"
        rows = [
            {
                "label": row.get("month"),
                "value": float(row.get("net") or 0),
                "income": float(row.get("income") or 0),
                "spending": float(row.get("spending") or 0),
            }
            for row in result
        ]
        return {"type": "cashflow_trend", "title": "Cash flow trend", "scope": scope, "source": source, "rows": rows}

    if name == "list_savings_goals" and isinstance(result, list):
        rows = [
            {
                "id": row.get("id"),
                "label": row.get("name") or "Savings goal",
                "value": float(row.get("saved") or 0),
                "target": float(row.get("target_amount") or 0),
                "date": row.get("deadline"),
            }
            for row in result[:8]
        ]
        return {"type": "progress_list", "title": "Savings goals", "scope": scope, "source": source, "rows": rows}

    if name == "list_accounts" and isinstance(result, list):
        rows = [
            {
                "id": row.get("id"),
                "label": row.get("name") or "Account",
                "detail": str(row.get("type") or "account").replace("_", " "),
                "value": float(row.get("balance") or 0),
                "currency": row.get("currency") or "USD",
            }
            for row in result[:10]
        ]
        return {"type": "account_list", "title": "Accounts", "scope": scope, "source": source, "rows": rows}

    return None


def _num(value) -> Decimal:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid number: {value!r}")
    if not number.is_finite() or abs(number) > Decimal("9999999999999.99"):
        raise HTTPException(status_code=400, detail="Number is outside the supported range")
    return number


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


def _clean_text(value, field: str, max_length: int, required: bool = True) -> Optional[str]:
    if value is None and not required:
        return None
    if not isinstance(value, str):
        raise HTTPException(status_code=400, detail=f"{field} must be text")
    cleaned = value.strip()
    if required and not cleaned:
        raise HTTPException(status_code=400, detail=f"{field} is required")
    if len(cleaned) > max_length:
        raise HTTPException(status_code=400, detail=f"{field} is too long")
    return cleaned or None


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


def _t_cashflow_trend(db: Session, user: User, months: int = 6, **_) -> list:
    try:
        months = max(1, min(int(months), 24))
    except (TypeError, ValueError):
        months = 6
    today = _user_today(user)
    month_index = today.year * 12 + today.month - 1
    start_index = month_index - months + 1
    start = date(start_index // 12, start_index % 12 + 1, 1)
    rows = (
        db.query(Transaction)
        .filter(Transaction.user_id == user.id, Transaction.transaction_date >= start)
        .order_by(Transaction.transaction_date)
        .all()
    )
    buckets = {}
    for offset in range(months):
        index = start_index + offset
        buckets[f"{index // 12:04d}-{index % 12 + 1:02d}"] = {"income": Decimal("0"), "spending": Decimal("0")}
    for transaction in rows:
        key = transaction.transaction_date.strftime("%Y-%m")
        if transaction.amount >= 0:
            buckets[key]["income"] += transaction.amount
        else:
            buckets[key]["spending"] += abs(transaction.amount)
    return [
        {
            "month": month,
            "income": _jsonable(values["income"]),
            "spending": _jsonable(values["spending"]),
            "net": _jsonable(values["income"] - values["spending"]),
        }
        for month, values in buckets.items()
    ]


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


# ─── Analytical tools ────────────────────────────────────────────────────────
# The arithmetic lives here rather than in the model. Projections and rates are
# exactly the thing an LLM gets subtly wrong, and a wrong number in a financial
# recommendation is worse than no recommendation.
def _month_floor(value: date) -> date:
    return value.replace(day=1)


def _add_months(value: date, delta: int) -> date:
    index = value.year * 12 + value.month - 1 + delta
    return date(index // 12, index % 12 + 1, 1)


def _monthly_flows(db: Session, user: User, *, months: int, today: date) -> list[dict]:
    """Income/spending per calendar month, oldest first, excluding this month.

    The current month is partial, so including it would understate every
    average and make every trend look like a decline.
    """
    first_complete = _add_months(_month_floor(today), -months)
    rows = (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user.id,
            Transaction.transaction_date >= first_complete,
            Transaction.transaction_date < _month_floor(today),
        )
        .all()
    )
    buckets: dict[str, dict] = {}
    for offset in range(months):
        month = _add_months(first_complete, offset)
        buckets[month.strftime("%Y-%m")] = {"income": Decimal("0"), "spending": Decimal("0")}
    for transaction in rows:
        key = transaction.transaction_date.strftime("%Y-%m")
        if key not in buckets:
            continue
        if transaction.amount >= 0:
            buckets[key]["income"] += transaction.amount
        else:
            buckets[key]["spending"] += abs(transaction.amount)
    return [
        {
            "month": month,
            "income": values["income"],
            "spending": values["spending"],
            "net": values["income"] - values["spending"],
        }
        for month, values in buckets.items()
    ]


def _average_monthly(flows: list[dict]) -> dict:
    """Average income/spending/surplus over months that had any activity."""
    active = [f for f in flows if f["income"] or f["spending"]]
    if not active:
        return {"income": Decimal("0"), "spending": Decimal("0"), "net": Decimal("0"), "months": 0}
    count = Decimal(len(active))
    return {
        "income": sum((f["income"] for f in active), Decimal("0")) / count,
        "spending": sum((f["spending"] for f in active), Decimal("0")) / count,
        "net": sum((f["net"] for f in active), Decimal("0")) / count,
        "months": len(active),
    }


def _t_financial_health(db: Session, user: User, **_) -> dict:
    """Headline ratios: savings rate, emergency runway, debt load, net worth."""
    today = _user_today(user)
    overview = _t_get_overview(db, user)
    flows = _monthly_flows(db, user, months=6, today=today)
    averages = _average_monthly(flows)

    liquid = Decimal(str(overview["liquid_balance"]))
    credit_debt = abs(Decimal(str(overview["credit_card_balance"])))
    avg_spending = averages["spending"]
    avg_income = averages["income"]

    savings_rate = (averages["net"] / avg_income * 100) if avg_income else None
    runway_months = (liquid / avg_spending) if avg_spending else None

    return {
        "as_of": today.isoformat(),
        "months_of_data": averages["months"],
        "avg_monthly_income": _jsonable(avg_income.quantize(Decimal("0.01"))),
        "avg_monthly_spending": _jsonable(avg_spending.quantize(Decimal("0.01"))),
        "avg_monthly_surplus": _jsonable(averages["net"].quantize(Decimal("0.01"))),
        "savings_rate_pct": _jsonable(savings_rate.quantize(Decimal("0.1"))) if savings_rate is not None else None,
        "emergency_fund_months": _jsonable(runway_months.quantize(Decimal("0.1"))) if runway_months is not None else None,
        "liquid_balance": overview["liquid_balance"],
        "credit_card_debt": _jsonable(credit_debt),
        "investable_assets": overview["assets_total"],
        "estimated_net_worth": overview["estimated_net_worth"],
        "monthly_history": [
            {
                "month": f["month"],
                "income": _jsonable(f["income"]),
                "spending": _jsonable(f["spending"]),
                "net": _jsonable(f["net"]),
            }
            for f in flows
        ],
    }


def _t_project_savings_goals(db: Session, user: User, **_) -> list:
    """Per goal: the gap, the pace it actually needs, and whether that is real."""
    today = _user_today(user)
    averages = _average_monthly(_monthly_flows(db, user, months=6, today=today))
    surplus = averages["net"]
    goals = db.query(SavingsGoal).filter(SavingsGoal.user_id == user.id).all()

    out = []
    for goal in goals:
        saved = sum((a.amount for a in goal.allocations), Decimal("0"))
        target = goal.target_amount or Decimal("0")
        gap = max(target - saved, Decimal("0"))
        entry = {
            "id": goal.id,
            "name": goal.name,
            "target_amount": _jsonable(target),
            "saved": _jsonable(saved),
            "remaining": _jsonable(gap),
            "percent_complete": _jsonable((saved / target * 100).quantize(Decimal("0.1"))) if target else None,
            "deadline": _jsonable(goal.deadline),
            "avg_monthly_surplus": _jsonable(surplus.quantize(Decimal("0.01"))),
        }

        if gap == 0:
            entry["verdict"] = "already funded"
        elif goal.deadline:
            days_left = (goal.deadline - today).days
            months_left = Decimal(max(days_left, 0)) / Decimal("30.44")
            entry["days_remaining"] = days_left
            if days_left <= 0:
                entry["verdict"] = "deadline passed and still short"
            else:
                required = (gap / months_left) if months_left > 0 else gap
                entry["required_monthly"] = _jsonable(required.quantize(Decimal("0.01")))
                if surplus <= 0:
                    entry["verdict"] = "not on track — no monthly surplus to fund it"
                elif required <= surplus:
                    entry["verdict"] = "on track at current surplus"
                else:
                    entry["shortfall_monthly"] = _jsonable((required - surplus).quantize(Decimal("0.01")))
                    entry["verdict"] = "not on track — needs more than the current surplus"
        else:
            entry["deadline"] = None
            if surplus > 0:
                entry["months_at_current_surplus"] = _jsonable((gap / surplus).quantize(Decimal("0.1")))
                entry["verdict"] = "no deadline set; reachable at current surplus"
            else:
                entry["verdict"] = "no deadline set and no monthly surplus"
        out.append(entry)
    return out


def _t_analyze_portfolio(db: Session, user: User, **_) -> dict:
    """Allocation, concentration, and per-holding cost basis.

    Returns quantity and purchase date per holding so the assistant can look up
    the live price with web_search and work out real gain/loss.
    """
    assets = db.query(Asset).filter(Asset.user_id == user.id).all()
    investments = [a for a in assets if (a.asset_class or "physical") == "investment"]
    total_investment = sum((a.total_value or Decimal("0") for a in investments), Decimal("0"))
    total_all = sum((a.total_value or Decimal("0") for a in assets), Decimal("0"))

    by_type: dict[str, Decimal] = {}
    for asset in investments:
        key = (asset.type or "other").lower()
        by_type[key] = by_type.get(key, Decimal("0")) + (asset.total_value or Decimal("0"))

    holdings = sorted(investments, key=lambda a: a.total_value or Decimal("0"), reverse=True)
    largest = holdings[0] if holdings else None

    return {
        "investment_total": _jsonable(total_investment),
        "all_assets_total": _jsonable(total_all),
        "holding_count": len(investments),
        "allocation_by_type": [
            {
                "type": key,
                "value": _jsonable(value),
                "share_pct": _jsonable((value / total_investment * 100).quantize(Decimal("0.1")))
                if total_investment
                else None,
            }
            for key, value in sorted(by_type.items(), key=lambda kv: kv[1], reverse=True)
        ],
        "largest_holding_share_pct": _jsonable(
            ((largest.total_value or Decimal("0")) / total_investment * 100).quantize(Decimal("0.1"))
        )
        if largest and total_investment
        else None,
        "holdings": [
            {
                "id": a.id,
                "name": a.name,
                "type": a.type,
                "quantity": _jsonable(a.quantity),
                "value_per_unit_recorded": _jsonable(a.value_per_unit),
                "total_value_recorded": _jsonable(a.total_value),
                "currency": a.currency or "USD",
                "purchase_date": _jsonable(a.purchase_date),
            }
            for a in holdings
        ],
        "note": (
            "value_per_unit_recorded is the value stored in the ledger, not a live "
            "quote. Look up current prices with web_search before judging performance."
        ),
    }


def _t_simulate_scenario(
    db: Session,
    user: User,
    monthly_contribution=0,
    months: int = 60,
    annual_return_pct=0,
    initial_amount=None,
    **_,
) -> dict:
    """Compound a monthly contribution and check it against real surplus."""
    try:
        months = max(1, min(int(months), 600))
    except (TypeError, ValueError):
        months = 60
    contribution = _num(monthly_contribution if monthly_contribution is not None else 0)
    annual_return = _num(annual_return_pct if annual_return_pct is not None else 0)
    if annual_return < -100 or annual_return > 100:
        raise HTTPException(status_code=400, detail="annual_return_pct must be between -100 and 100")

    today = _user_today(user)
    averages = _average_monthly(_monthly_flows(db, user, months=6, today=today))
    surplus = averages["net"]

    if initial_amount is None:
        overview = _t_get_overview(db, user)
        balance = Decimal(str(overview["liquid_balance"]))
    else:
        balance = _num(initial_amount)
    starting = balance

    monthly_rate = annual_return / Decimal("1200")
    milestones = {12, 24, 36, 60, 120, months}
    schedule = []
    for month in range(1, months + 1):
        balance = balance * (Decimal("1") + monthly_rate) + contribution
        if month in milestones:
            schedule.append(
                {
                    "month": month,
                    "years": _jsonable((Decimal(month) / 12).quantize(Decimal("0.1"))),
                    "balance": _jsonable(balance.quantize(Decimal("0.01"))),
                }
            )

    contributed = contribution * months
    return {
        "assumptions": {
            "starting_amount": _jsonable(starting.quantize(Decimal("0.01"))),
            "monthly_contribution": _jsonable(contribution),
            "months": months,
            "annual_return_pct": _jsonable(annual_return),
            "starting_amount_source": "current liquid balance" if initial_amount is None else "caller supplied",
        },
        "final_balance": _jsonable(balance.quantize(Decimal("0.01"))),
        "total_contributed": _jsonable(contributed.quantize(Decimal("0.01"))),
        "growth_from_returns": _jsonable((balance - starting - contributed).quantize(Decimal("0.01"))),
        "schedule": schedule,
        "feasibility": {
            "avg_monthly_surplus": _jsonable(surplus.quantize(Decimal("0.01"))),
            "months_of_data": averages["months"],
            "contribution_fits_surplus": bool(contribution <= surplus),
            "surplus_shortfall": _jsonable((contribution - surplus).quantize(Decimal("0.01")))
            if contribution > surplus
            else None,
        },
    }


def _t_affordability_check(db: Session, user: User, amount=0, in_months: int = 0, **_) -> dict:
    """Can this purchase be absorbed now (or after saving), and what breaks."""
    cost = _num(amount)
    if cost <= 0:
        raise HTTPException(status_code=400, detail="amount must be greater than zero")
    try:
        in_months = max(0, min(int(in_months), 240))
    except (TypeError, ValueError):
        in_months = 0

    today = _user_today(user)
    overview = _t_get_overview(db, user)
    liquid = Decimal(str(overview["liquid_balance"]))
    averages = _average_monthly(_monthly_flows(db, user, months=6, today=today))
    surplus, avg_spending = averages["net"], averages["spending"]

    projected = liquid + (surplus * in_months)
    after = projected - cost
    runway_after = (after / avg_spending) if avg_spending else None

    return {
        "cost": _jsonable(cost),
        "in_months": in_months,
        "liquid_now": _jsonable(liquid),
        "avg_monthly_surplus": _jsonable(surplus.quantize(Decimal("0.01"))),
        "avg_monthly_spending": _jsonable(avg_spending.quantize(Decimal("0.01"))),
        "projected_liquid_before_purchase": _jsonable(projected.quantize(Decimal("0.01"))),
        "liquid_after_purchase": _jsonable(after.quantize(Decimal("0.01"))),
        "emergency_fund_months_after": _jsonable(runway_after.quantize(Decimal("0.1")))
        if runway_after is not None
        else None,
        "months_to_afford_from_surplus": _jsonable((max(cost - liquid, Decimal("0")) / surplus).quantize(Decimal("0.1")))
        if surplus > 0 and cost > liquid
        else (0 if cost <= liquid else None),
        "covers_cost": bool(after >= 0),
    }


def _t_analyze_spending_trends(db: Session, user: User, months: int = 6, **_) -> dict:
    """Per-category drift plus outlier transactions, over complete months only."""
    try:
        months = max(2, min(int(months), 24))
    except (TypeError, ValueError):
        months = 6

    today = _user_today(user)
    start = _add_months(_month_floor(today), -months)
    rows = (
        db.query(Transaction, Category.name)
        .join(Category, Category.id == Transaction.category_id, isouter=True)
        .filter(
            Transaction.user_id == user.id,
            Transaction.amount < 0,
            Transaction.transaction_date >= start,
            Transaction.transaction_date < _month_floor(today),
        )
        .all()
    )

    per_category: dict[str, dict[str, Decimal]] = {}
    for transaction, category_name in rows:
        category = category_name or "Uncategorized"
        key = transaction.transaction_date.strftime("%Y-%m")
        per_category.setdefault(category, {})
        bucket = per_category[category]
        bucket[key] = bucket.get(key, Decimal("0")) + abs(transaction.amount)

    latest_key = _add_months(_month_floor(today), -1).strftime("%Y-%m")
    trends = []
    for category, by_month in per_category.items():
        latest = by_month.get(latest_key, Decimal("0"))
        prior = [v for k, v in by_month.items() if k != latest_key]
        baseline = (sum(prior, Decimal("0")) / Decimal(len(prior))) if prior else Decimal("0")
        change = ((latest - baseline) / baseline * 100) if baseline else None
        trends.append(
            {
                "category": category,
                "latest_month": latest_key,
                "latest_month_spend": _jsonable(latest.quantize(Decimal("0.01"))),
                "prior_months_average": _jsonable(baseline.quantize(Decimal("0.01"))),
                "change_pct": _jsonable(change.quantize(Decimal("0.1"))) if change is not None else None,
                "total_over_period": _jsonable(sum(by_month.values(), Decimal("0")).quantize(Decimal("0.01"))),
            }
        )
    trends.sort(key=lambda row: row["change_pct"] if row["change_pct"] is not None else -999, reverse=True)

    # Outliers: a single charge far above its own category's typical size.
    category_totals: dict[str, list[Decimal]] = {}
    for transaction, category_name in rows:
        category_totals.setdefault(category_name or "Uncategorized", []).append(abs(transaction.amount))
    outliers = []
    for transaction, category_name in rows:
        category = category_name or "Uncategorized"
        amounts = category_totals[category]
        if len(amounts) < 4:
            continue
        mean = sum(amounts, Decimal("0")) / Decimal(len(amounts))
        value = abs(transaction.amount)
        if mean > 0 and value >= mean * 3:
            outliers.append(
                {
                    "id": transaction.id,
                    "date": _jsonable(transaction.transaction_date),
                    "description": transaction.description,
                    "amount": _jsonable(value),
                    "category": category,
                    "category_average": _jsonable(mean.quantize(Decimal("0.01"))),
                }
            )
    outliers.sort(key=lambda row: row["amount"], reverse=True)

    return {
        "period": f"{start.isoformat()} to {latest_key}",
        "complete_months_analyzed": months,
        "category_trends": trends[:15],
        "unusually_large_charges": outliers[:10],
    }


def _t_find_recurring_waste(db: Session, user: User, **_) -> dict:
    """Annualised cost of every subscription, and which look dormant."""
    today = _user_today(user)
    recurring = (
        db.query(RecurringTransaction)
        .filter(RecurringTransaction.user_id == user.id, RecurringTransaction.is_active.is_(True))
        .all()
    )
    per_year = {"daily": 365, "weekly": 52, "biweekly": 26, "monthly": 12, "quarterly": 4, "yearly": 1}
    cutoff = today - timedelta(days=75)

    items, annual_total = [], Decimal("0")
    for entry in recurring:
        amount = abs(entry.amount or Decimal("0"))
        occurrences = per_year.get((entry.period or "monthly").lower(), 12)
        annualised = amount * occurrences
        # Outgoing only; salary and other inflows are not waste.
        if (entry.amount or Decimal("0")) < 0:
            annual_total += annualised

        last_seen = None
        description = (entry.description or "").strip()
        if description:
            match = (
                db.query(Transaction.transaction_date)
                .filter(
                    Transaction.user_id == user.id,
                    Transaction.description.ilike(f"%{description}%"),
                )
                .order_by(Transaction.transaction_date.desc())
                .first()
            )
            last_seen = match[0] if match else None

        items.append(
            {
                "id": entry.id,
                "description": entry.description,
                "amount": _jsonable(entry.amount),
                "direction": "income" if (entry.amount or Decimal("0")) >= 0 else "expense",
                "period": entry.period,
                "annualised_cost": _jsonable(annualised.quantize(Decimal("0.01"))),
                "next_date": _jsonable(entry.next_date),
                "is_variable": entry.is_variable,
                "last_matching_transaction": _jsonable(last_seen),
                "possibly_unused": bool(
                    (entry.amount or Decimal("0")) < 0 and (last_seen is None or last_seen < cutoff)
                ),
            }
        )
    items.sort(key=lambda row: row["annualised_cost"], reverse=True)

    return {
        "as_of": today.isoformat(),
        "total_annualised_expense": _jsonable(annual_total.quantize(Decimal("0.01"))),
        "items": items,
        "note": (
            "possibly_unused means no ledger transaction matched the description in "
            "75 days. Treat it as a prompt to check, not proof the subscription is dead."
        ),
    }


def _t_save_memory(db: Session, user: User, content: str = "", **_) -> dict:
    if not isinstance(content, str):
        return {"saved": False, "reason": "content must be text"}
    content = content.strip()
    if not content:
        return {"saved": False, "reason": "empty"}
    memory_count = db.query(func.count(AssistantMemory.id)).filter(AssistantMemory.user_id == user.id).scalar()
    if memory_count >= 100:
        return {"saved": False, "reason": "memory limit reached"}
    db.add(AssistantMemory(user_id=user.id, content=content[:1000]))
    db.commit()
    return {"saved": True}


READ_TOOLS = {
    "get_overview": _t_get_overview,
    "list_accounts": _t_list_accounts,
    "list_transactions": _t_list_transactions,
    "spending_by_category": _t_spending_by_category,
    "cashflow_trend": _t_cashflow_trend,
    "list_recurring": _t_list_recurring,
    "list_savings_goals": _t_list_savings_goals,
    "list_loans": _t_list_loans,
    "list_assets": _t_list_assets,
    "financial_health": _t_financial_health,
    "project_savings_goals": _t_project_savings_goals,
    "analyze_portfolio": _t_analyze_portfolio,
    "simulate_scenario": _t_simulate_scenario,
    "affordability_check": _t_affordability_check,
    "analyze_spending_trends": _t_analyze_spending_trends,
    "find_recurring_waste": _t_find_recurring_waste,
    "save_memory": _t_save_memory,
}

WRITE_TOOLS = {"add_transaction", "add_account", "add_savings_goal", "add_loan"}

# ─── Request routing ─────────────────────────────────────────────────────────
# Anything asking for judgement, a projection, or outside-world data earns the
# deep tier. Checked FIRST, so "how much should I invest" routes deep even
# though it also looks like a "how much" lookup.
_DEEP_SIGNALS = (
    "invest", "portfolio", "stock", "share", "etf", "bond", "gold", "silver",
    "crypto", "bitcoin", "retire", "pension", "market", "inflation", "yield",
    "interest rate", "mortgage", "diversif", "allocat", "risk", "return",
    "should i", "should we", "worth it", "better than", "compare", "versus",
    " vs ", "afford", "plan", "project", "forecast", "scenario", "what if",
    "simulate", "strateg", "optimi", "advice", "advise", "recommend", "opinion",
    "goal", "debt", "payoff", "pay off", "save for", "saving for", "tax",
    "waste", "wasting", "cut back", "trend", "why", "explain", "price",
)
# Explicit user request for depth always wins.
_DEPTH_OVERRIDES = ("think hard", "think deeply", "deep dive", "analyse", "analyze", "in detail")
# Unambiguous ledger lookups needing no judgement at all.
_QUICK_SIGNALS = (
    "balance", "how much did i spend", "how much have i spent", "what did i spend",
    "total spent", "net worth", "how many", "list my", "show me my",
    "what are my", "recent transaction", "last transaction",
)
_QUICK_MAX_CHARS = 120

# The quick tier gets plain readers only — no analytics, no writes, no search.
QUICK_TOOL_NAMES = (
    "get_overview", "list_accounts", "list_transactions", "spending_by_category",
    "cashflow_trend", "list_savings_goals", "list_loans", "list_assets", "list_recurring",
)


def _route_request(message: str) -> str:
    """Pick a tier for this question. Biased toward spending more, not less.

    A misroute that under-thinks produces the shallow answers this assistant was
    rebuilt to eliminate, so anything ambiguous goes to `standard` or `deep`.
    """
    text = message.lower()
    if any(signal in text for signal in _DEPTH_OVERRIDES):
        return "deep"
    if any(signal in text for signal in _DEEP_SIGNALS):
        return "deep"
    if len(text.strip()) <= _QUICK_MAX_CHARS and any(signal in text for signal in _QUICK_SIGNALS):
        return "quick"
    return "standard"


def _server_tools(user: User) -> list[dict]:
    """Web search runs on Anthropic's infrastructure.

    Results arrive inside the same response, so it never reaches the client-side
    tool dispatch. The user's zone is passed through so results are localised —
    "current mortgage rates" should not silently mean a different country.
    """
    tool: dict = {
        "type": "web_search_20260209",
        "name": "web_search",
        "max_uses": WEB_SEARCH_MAX_USES,
    }
    zone_name = _clean_timezone(getattr(user, "timezone", None))
    if zone_name:
        tool["user_location"] = {"type": "approximate", "timezone": zone_name}
    return [tool]


# ─── Tool schemas sent to Claude ─────────────────────────────────────────────
def _tool_schemas(only: Optional[tuple] = None) -> list:
    """Every client-side tool schema, or just `only` for the quick tier.

    Order is fixed: the list renders ahead of everything else, so reordering it
    would invalidate the whole cached prefix.
    """
    schemas = _all_tool_schemas()
    if only is None:
        return schemas
    allowed = set(only)
    return [schema for schema in schemas if schema["name"] in allowed]


def _all_tool_schemas() -> list:
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
        {
            "name": "cashflow_trend",
            "description": "Get monthly income, spending, and net cash flow for a trend comparison.",
            "input_schema": {
                "type": "object",
                "properties": {"months": {"type": "integer", "minimum": 1, "maximum": 24}},
            },
        },
        {"name": "list_recurring", "description": "List active recurring transactions (subscriptions, salary, bills).", "input_schema": {"type": "object", "properties": {}}},
        {"name": "list_savings_goals", "description": "List savings goals with target and saved amounts.", "input_schema": {"type": "object", "properties": {}}},
        {"name": "list_loans", "description": "List money the user has lent out and repayment status.", "input_schema": {"type": "object", "properties": {}}},
        {"name": "list_assets", "description": "List the user's assets (physical and investment).", "input_schema": {"type": "object", "properties": {}}},
        {
            "name": "financial_health",
            "description": (
                "Headline financial ratios computed from the last 6 complete months: average "
                "income, spending and surplus, savings rate, emergency-fund runway in months, "
                "credit card debt, and net worth, plus the month-by-month history. Start here "
                "for any broad question about how the user is doing or whether they can afford "
                "a change in direction."
            ),
            "input_schema": {"type": "object", "properties": {}},
        },
        {
            "name": "project_savings_goals",
            "description": (
                "For every savings goal: amount saved, remaining gap, percent complete, the "
                "monthly contribution actually required to hit the deadline, and a verdict on "
                "whether that is achievable at the user's real surplus. Use this instead of "
                "list_savings_goals whenever the question is about progress or feasibility."
            ),
            "input_schema": {"type": "object", "properties": {}},
        },
        {
            "name": "analyze_portfolio",
            "description": (
                "Investment allocation by asset type, concentration risk, and every holding "
                "with quantity, recorded unit value, and purchase date. The recorded values are "
                "ledger entries, NOT live quotes — pair this with web_search to get current "
                "prices before assessing performance or gain/loss."
            ),
            "input_schema": {"type": "object", "properties": {}},
        },
        {
            "name": "simulate_scenario",
            "description": (
                "Compound a monthly contribution forward and check it against the user's real "
                "surplus. Use for 'what if I invest X per month', retirement or growth "
                "projections, and comparing investment options. Returns the balance schedule, "
                "total contributed, growth from returns, and whether the contribution actually "
                "fits the user's cash flow. Look up a realistic annual_return_pct with "
                "web_search rather than guessing."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "monthly_contribution": {"type": "number", "description": "Amount added each month."},
                    "months": {"type": "integer", "description": "Horizon in months (default 60, max 600)."},
                    "annual_return_pct": {
                        "type": "number",
                        "description": "Expected annual return as a percent, e.g. 7 for 7%. Use 0 for plain saving.",
                    },
                    "initial_amount": {
                        "type": "number",
                        "description": "Starting balance. Omit to use the user's current liquid balance.",
                    },
                },
                "required": ["monthly_contribution", "months"],
            },
        },
        {
            "name": "affordability_check",
            "description": (
                "Decide whether a one-off purchase is affordable now or after saving for a "
                "number of months. Returns liquid balance before and after, the emergency-fund "
                "runway left afterwards, and how many months of surplus it would take to cover."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "amount": {"type": "number", "description": "Cost of the purchase."},
                    "in_months": {
                        "type": "integer",
                        "description": "Months of saving before buying (default 0, i.e. buy today).",
                    },
                },
                "required": ["amount"],
            },
        },
        {
            "name": "analyze_spending_trends",
            "description": (
                "Per-category spending drift over complete months: last full month versus the "
                "trailing average with percent change, plus individual charges far above their "
                "category's norm. Use to find where spending is creeping up or something looks "
                "wrong."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "months": {"type": "integer", "description": "Complete months to analyze (default 6, max 24)."}
                },
            },
        },
        {
            "name": "find_recurring_waste",
            "description": (
                "Every active recurring charge with its annualised cost, the total annual "
                "subscription burden, and a flag for entries with no matching transaction in 75 "
                "days (possibly cancelled or forgotten). Use for 'what am I wasting money on'."
            ),
            "input_schema": {"type": "object", "properties": {}},
        },
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


# Everything in here is byte-stable across requests, so it sits ahead of the
# cache breakpoint. Nothing user-specific or time-varying may go in this string.
_STABLE_SYSTEM_PROMPT = """You are Fin, this user's private financial analyst inside their Fintrack app. You are not a generic chatbot and not a support agent — you are the person they turn to before making a money decision.

## Who you are
You are direct, numerate, and willing to disagree. The user built this app for themselves and wants a real opinion, so give one: say what you would do and why. Hedging, endless "consult a professional" disclaimers, and both-sides summaries that avoid a conclusion are failures, not caution. If they ask whether to buy gold, tell them.

Being opinionated does not mean being overconfident. State the assumption a conclusion rests on, and say plainly when data is thin or a number is an estimate. Change your mind when the numbers say so.

## Non-negotiable: never invent a number
Every figure you state must come from a tool result. Two specific traps:
- **Prices, rates, and market data are not in your training data in any usable form.** They are stale by years. If a question touches a current price, interest rate, inflation figure, market level, tax threshold, or recent news, you MUST call `web_search` first. Answering a price question from memory is the worst thing you can do here.
- **Do not do financial arithmetic in your head.** Projections, compounding, required savings rates, and affordability are computed exactly by `simulate_scenario`, `affordability_check`, and `project_savings_goals`. Use them and quote their output.

If you cannot ground something, say you could not find it.

## How you work
- Lead with the answer or recommendation, then the reasoning that supports it. Show the numbers you relied on.
- Reach for the analytical tools, not just the list tools. `financial_health` is the right opening move for most broad questions; `project_savings_goals` beats `list_savings_goals` whenever the question is about progress.
- Combine sources. Judging a holding means `analyze_portfolio` for the position plus `web_search` for the live price. Projecting growth means `web_search` for a defensible return assumption plus `simulate_scenario` to compound it.
- Be proactive within the scope of the question. If you notice something genuinely important while answering — a goal that has quietly gone off track, a subscription that looks dead, an emergency fund under two months — say so briefly at the end. One or two observations, not an audit they did not ask for.
- Cite the source when you use `web_search`, and give the figure's date. A price without a date is not useful.
- When you learn something durable about the user — a goal, a constraint, a risk tolerance, a rule they live by, a decision they made — call `save_memory`. This is your long-term memory and the reason you get better over time.

## Changing their data
To modify data, call the matching `add_*` tool. These are NOT executed. They surface to the user as a confirmation card, and only run when the user accepts. So: tell them what you have prepared and ask them to confirm. Never say a change is done — you cannot know that until they confirm.

## Format
Concise Markdown. Short bold labels and bullets where they help. Never use tables. The interface renders read-tool results as its own visual blocks, so summarize the finding and what it means rather than replaying every row. Match length to the question: a one-line question gets a short answer, a real decision gets the analysis it deserves."""


def _build_system_blocks(db: Session, user: User) -> list[dict]:
    """System prompt as two cached blocks: frozen persona, then memories.

    Render order is tools -> system -> messages. Both blocks carry a breakpoint:
    the first caches tool schemas + persona (invalidated only by a tool or model
    change), the second adds memories (invalidated only when `save_memory`
    fires). Keeping them separate means a new memory does not force the tool
    schemas to be repriced.

    Nothing time-varying belongs here. The clock and balances live at the tail of
    the message array instead — see `_live_context_text`.
    """
    memories = (
        db.query(AssistantMemory)
        .filter(AssistantMemory.user_id == user.id)
        .order_by(AssistantMemory.created_at.desc())
        .limit(50)
        .all()
    )
    memory_block = "\n".join(f"- {m.content}" for m in memories) or "- (nothing yet)"

    return [
        {"type": "text", "text": _STABLE_SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}},
        {
            "type": "text",
            "text": f"## What you remember about this user\n{memory_block}\n",
            "cache_control": {"type": "ephemeral"},
        },
    ]


def _live_context_text(db: Session, user: User) -> str:
    """The only genuinely per-request context: the clock and current balances.

    This is appended at the END of the message array rather than to the system
    prompt. In the system prompt it would sit ahead of the conversation history
    and reprice the entire history on every call.
    """
    now = _user_now(user)
    zone_name = _clean_timezone(getattr(user, "timezone", None)) or "UTC"
    return (
        "## Current date and time\n"
        f"- Today is {now.strftime('%A, %d %B %Y')} ({now.date().isoformat()}).\n"
        f"- Local time is {now.strftime('%H:%M')} in {zone_name}.\n"
        "This is authoritative. Use it for anything date-related and never substitute a "
        "date from your training data. Your knowledge of the world has a cutoff well "
        "before today, so treat any fact that changes over time as unknown until you "
        "look it up.\n\n"
        "## Live financial snapshot\n"
        f"{_dump(_t_get_overview(db, user))}\n"
        f"Accounts: {_dump(_t_list_accounts(db, user))}\n"
        "Amounts are in each account's own currency (mostly USD).\n"
    )


def _assemble_messages(history: list, live_context: str, message: str) -> list[dict]:
    """History (cacheable) followed by the volatile context and the new message.

    A breakpoint on the last history turn lets every prior turn be served as a
    cache read. The volatile block sits after it so it never invalidates history.
    """
    messages: list[dict] = []
    last_index = len(history) - 1
    for index, stored in enumerate(history):
        content = stored.content[:MAX_REPLY_CHARS]
        if index == last_index:
            messages.append(
                {
                    "role": stored.role,
                    "content": [
                        {"type": "text", "text": content, "cache_control": {"type": "ephemeral"}}
                    ],
                }
            )
        else:
            messages.append({"role": stored.role, "content": content})
    messages.append(
        {
            "role": "user",
            "content": [
                {"type": "text", "text": live_context},
                {"type": "text", "text": message},
            ],
        }
    )
    return messages


# ─── Request / response models ───────────────────────────────────────────────
class ChatRequest(BaseModel):
    conversation_id: Optional[int] = Field(default=None, gt=0)
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)
    # IANA zone from the browser. Persisted on the user so every later turn and
    # the briefing endpoint agree on what "today" means.
    timezone: Optional[str] = Field(default=None, max_length=64)


class ExecuteRequest(BaseModel):
    conversation_id: Optional[int] = Field(default=None, gt=0)
    tool: str = Field(min_length=1, max_length=50)
    input: dict
    action_token: str = Field(min_length=32, max_length=128)

    @field_validator("input")
    @classmethod
    def validate_input_size(cls, value: dict) -> dict:
        try:
            serialized = json.dumps(value, separators=(",", ":"), allow_nan=False)
        except (TypeError, ValueError):
            raise ValueError("input must contain valid JSON values")
        if len(serialized) > 8000:
            raise ValueError("input is too large")
        return value


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


def _register_pending_action(user_id: int, conversation_id: int, tool: str, tool_input: dict) -> str:
    now = monotonic()
    token = secrets.token_urlsafe(32)
    with _pending_actions_lock:
        expired = [key for key, item in _pending_actions.items() if item["expires_at"] <= now]
        for key in expired:
            _pending_actions.pop(key, None)
        _pending_actions[token] = {
            "user_id": user_id,
            "conversation_id": conversation_id,
            "tool": tool,
            "input": tool_input,
            "expires_at": now + PENDING_ACTION_TTL_SECONDS,
        }
        while len(_pending_actions) > MAX_PENDING_ACTIONS:
            _pending_actions.popitem(last=False)
    return token


def _consume_pending_action(token: str, user_id: int, conversation_id: Optional[int]) -> dict:
    with _pending_actions_lock:
        action = _pending_actions.get(token)
        if not action or action["expires_at"] <= monotonic():
            _pending_actions.pop(token, None)
            raise HTTPException(status_code=400, detail="Pending action is invalid or expired")
        if action["user_id"] != user_id or action["conversation_id"] != conversation_id:
            raise HTTPException(status_code=404, detail="Pending action not found")
        _pending_actions.pop(token)
    return action


def _accumulate_usage(totals: dict, response) -> None:
    """Sum token counters across every API call made for one user turn."""
    usage = getattr(response, "usage", None)
    if usage is None:
        return
    totals["input_tokens"] += getattr(usage, "input_tokens", 0) or 0
    totals["output_tokens"] += getattr(usage, "output_tokens", 0) or 0
    totals["cache_read_input_tokens"] += getattr(usage, "cache_read_input_tokens", 0) or 0
    totals["cache_creation_input_tokens"] += getattr(usage, "cache_creation_input_tokens", 0) or 0
    server_use = getattr(usage, "server_tool_use", None)
    if server_use is not None:
        totals["web_searches"] += getattr(server_use, "web_search_requests", 0) or 0


def _price_usage(totals: dict, model: str) -> dict:
    """Cost this turn, split so a cache regression is obvious at a glance.

    `cache_hit_rate` is the number to watch: if it falls toward zero on a
    multi-turn conversation, something has started invalidating the prefix.
    Web searches are metered separately by Anthropic and are reported as a count
    rather than folded into this figure.
    """
    rates = MODEL_PRICING.get(model, MODEL_PRICING[MODEL])
    per_token_in = rates["input"] / Decimal(1_000_000)
    per_token_out = rates["output"] / Decimal(1_000_000)

    cost = (
        Decimal(totals["input_tokens"]) * per_token_in
        + Decimal(totals["output_tokens"]) * per_token_out
        + Decimal(totals["cache_read_input_tokens"]) * per_token_in * CACHE_READ_MULTIPLIER
        + Decimal(totals["cache_creation_input_tokens"]) * per_token_in * CACHE_WRITE_MULTIPLIER
    )
    billed_input = totals["input_tokens"] + totals["cache_read_input_tokens"]
    hit_rate = (Decimal(totals["cache_read_input_tokens"]) / Decimal(billed_input) * 100) if billed_input else Decimal(0)

    return {
        "model": model,
        "input_tokens": totals["input_tokens"],
        "output_tokens": totals["output_tokens"],
        "cache_read_tokens": totals["cache_read_input_tokens"],
        "cache_write_tokens": totals["cache_creation_input_tokens"],
        "web_searches": totals["web_searches"],
        "cache_hit_rate_pct": float(hit_rate.quantize(Decimal("0.1"))),
        # Six places: a cheap turn is a fraction of a cent and would round to 0.00.
        "estimated_cost_usd": float(cost.quantize(Decimal("0.000001"))),
    }


def _collect_sources(response, sources: list[dict]) -> None:
    """Pull citations out of web_search results so the UI can show provenance."""
    for block in response.content:
        if getattr(block, "type", None) != "web_search_tool_result":
            continue
        content = getattr(block, "content", None)
        # A successful search returns a list of results; an error returns a
        # single object with an error_code, so guard before iterating.
        if not isinstance(content, list):
            logger.info("assistant_web_search_error %s", kv(error=str(getattr(content, "error_code", "unknown"))))
            continue
        for result in content:
            url = getattr(result, "url", None)
            if not url or any(existing["url"] == url for existing in sources):
                continue
            sources.append(
                {
                    "url": url,
                    "title": getattr(result, "title", None) or url,
                    "page_age": getattr(result, "page_age", None),
                }
            )


def _prune_conversation_messages(db: Session, conversation_id: int) -> None:
    stale_ids = [
        row[0]
        for row in (
            db.query(AssistantMessage.id)
            .filter(AssistantMessage.conversation_id == conversation_id)
            .order_by(AssistantMessage.id.desc())
            .offset(MAX_STORED_MESSAGES)
            .all()
        )
    ]
    if stale_ids:
        db.query(AssistantMessage).filter(AssistantMessage.id.in_(stale_ids)).delete(synchronize_session=False)


# ─── Endpoints ───────────────────────────────────────────────────────────────
@router.get("/conversations")
def list_conversations(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = (
        db.query(AssistantConversation)
        .filter(AssistantConversation.user_id == current_user.id)
        .order_by(AssistantConversation.updated_at.desc())
        .limit(MAX_LISTED_CONVERSATIONS)
        .all()
    )
    return [{"id": c.id, "title": c.title, "updated_at": _jsonable(c.updated_at)} for c in rows]


@router.get("/briefing")
def get_briefing(
    tz: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return a fast, model-free briefing sourced only from the user's ledger.

    `tz` lets the browser report its zone here too, so a user who has never sent
    a chat message still gets dates in their own zone rather than the server's.
    """
    reported_zone = _clean_timezone(tz)
    if reported_zone and reported_zone != current_user.timezone:
        current_user.timezone = reported_zone
        db.commit()

    today = _user_today(current_user)
    month_input = {"date_from": today.replace(day=1).isoformat(), "date_to": today.isoformat()}
    overview = _t_get_overview(db, current_user)
    categories = _t_spending_by_category(db, current_user, **month_input)
    transactions = _t_list_transactions(db, current_user, **month_input, limit=5)
    blocks = []
    if overview.get("account_count", 0):
        blocks.append(_visual_block_for_tool("get_overview", {}, overview, as_of=today))
    if categories:
        blocks.append(_visual_block_for_tool("spending_by_category", month_input, categories, as_of=today))
    elif transactions:
        blocks.append(_visual_block_for_tool("list_transactions", month_input, transactions, as_of=today))
    return {"as_of": today.isoformat(), "blocks": [block for block in blocks if block]}


@router.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    conv = _get_conversation(db, current_user, conversation_id)
    messages = (
        db.query(AssistantMessage)
        .filter(AssistantMessage.conversation_id == conv.id, AssistantMessage.user_id == current_user.id)
        .order_by(AssistantMessage.id.desc())
        .limit(MAX_STORED_MESSAGES)
        .all()
    )
    return {
        "id": conv.id,
        "title": conv.title,
        "messages": [
            {"role": m.role, "content": m.content[:MAX_REPLY_CHARS], "created_at": _jsonable(m.created_at)}
            for m in reversed(messages)
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
        .limit(100)
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
@limiter.limit("20/minute")
def chat(
    req: ChatRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    del request
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

    user_id = current_user.id

    # Remember the browser's zone so the assistant, and the briefing endpoint,
    # resolve "today" the way the user experiences it rather than in UTC.
    reported_zone = _clean_timezone(req.timezone)
    if reported_zone and reported_zone != current_user.timezone:
        current_user.timezone = reported_zone
        db.commit()

    # Resolve the conversation. New conversations are persisted only after a
    # successful model response so retries cannot leave empty history rows.
    if req.conversation_id:
        conv = _get_conversation(db, current_user, req.conversation_id)
    else:
        conversation_count = (
            db.query(func.count(AssistantConversation.id))
            .filter(AssistantConversation.user_id == current_user.id)
            .scalar()
        )
        if conversation_count >= MAX_CONVERSATIONS:
            raise HTTPException(status_code=409, detail="Conversation limit reached; delete an older chat first")
        conv = None

    # Build the message history for the API from stored turns
    history = []
    if conv is not None:
        history = (
            db.query(AssistantMessage)
            .filter(AssistantMessage.conversation_id == conv.id, AssistantMessage.user_id == user_id)
            .order_by(AssistantMessage.id.desc())
            .limit(MAX_HISTORY_MESSAGES)
            .all()
        )
    history = list(reversed(history))
    api_messages = _assemble_messages(history, _live_context_text(db, current_user), message)

    # Depth is chosen per question: a balance lookup does not need Sonnet with
    # deep thinking, and an investment question must not be answered without it.
    tier_name = _route_request(message)
    tier = TIERS[tier_name]
    model = tier["model"]

    system_blocks = _build_system_blocks(db, current_user)
    if tier_name == "quick":
        # Haiku cannot use the _20260209 search tool, and a plain ledger lookup
        # has no reason to reach the web — so the quick tier gets readers only.
        tools = _tool_schemas(QUICK_TOOL_NAMES)
    else:
        # Server tools last so the schema list stays byte-stable for the cache.
        tools = _tool_schemas() + _server_tools(current_user)

    request_kwargs: dict = {}
    if tier["thinking"]:
        request_kwargs["thinking"] = {"type": "adaptive"}
    if tier["effort"]:
        # Haiku rejects output_config.effort outright, hence the guard.
        request_kwargs["output_config"] = {"effort": tier["effort"]}

    pending_actions: list[dict] = []
    visual_blocks: list[dict] = []
    sources: list[dict] = []
    usage_totals = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 0,
        "web_searches": 0,
    }

    # Streaming, and a long timeout: adaptive thinking plus web search makes a
    # turn far slower than the old 30s non-streaming call could survive.
    client = anthropic.Anthropic(api_key=api_key, timeout=300.0, max_retries=1)
    response = None
    pause_resumes = 0
    try:
        for _ in range(MAX_TOOL_ITERATIONS):
            with client.messages.stream(
                model=model,
                max_tokens=MAX_TOKENS,
                system=system_blocks,
                tools=tools,
                messages=api_messages,
                # Auto-places the fourth breakpoint on the last cacheable block,
                # so each loop iteration reads the previous iteration's prefix.
                cache_control={"type": "ephemeral"},
                **request_kwargs,
            ) as stream:
                response = stream.get_final_message()

            _accumulate_usage(usage_totals, response)
            _collect_sources(response, sources)

            if response.stop_reason == "refusal":
                logger.warning("assistant_refusal %s", kv(user_id=user_id))
                break

            # Server-side tools run their own loop inside the response. When it
            # hits an iteration cap the turn pauses; re-sending resumes it.
            if response.stop_reason == "pause_turn":
                if pause_resumes >= MAX_PAUSE_RESUMES:
                    break
                pause_resumes += 1
                api_messages.append({"role": "assistant", "content": response.content})
                continue

            if response.stop_reason != "tool_use":
                break

            # Echo content back verbatim — thinking blocks must survive intact
            # alongside the tool_use blocks they belong to.
            api_messages.append({"role": "assistant", "content": response.content})
            tool_results = []
            for tool_block in response.content:
                # Skips thinking, text, and the server_tool_use /
                # web_search_tool_result pairs, which are already resolved.
                if tool_block.type != "tool_use":
                    continue
                name, tool_input = tool_block.name, dict(tool_block.input or {})
                if name in WRITE_TOOLS:
                    pending_actions.append(
                        {
                            "tool": name,
                            "input": tool_input,
                            "summary": _action_summary(name, tool_input),
                        }
                    )
                    result_str = (
                        "Proposed and surfaced to the user for confirmation. It is NOT executed yet — "
                        "do not say it is done. Briefly tell the user what you prepared and ask them to confirm."
                    )
                elif name in READ_TOOLS:
                    try:
                        tool_result = READ_TOOLS[name](db, current_user, **tool_input)
                        result_str = _dump(tool_result)
                        visual_block = _visual_block_for_tool(
                            name, tool_input, tool_result, as_of=_user_today(current_user)
                        )
                        if visual_block:
                            visual_blocks.append(visual_block)
                    except HTTPException as exc:
                        result_str = _dump({"error": exc.detail})
                    except (SQLAlchemyError, TypeError, ValueError) as exc:
                        db.rollback()
                        logger.exception(
                            "assistant_tool_error %s",
                            kv(tool=name, error=str(exc), user_id=user_id),
                        )
                        result_str = _dump({"error": "The requested ledger data could not be read."})
                else:
                    result_str = _dump({"error": f"Unknown tool {name}"})
                tool_results.append({"type": "tool_result", "tool_use_id": tool_block.id, "content": result_str})
            # An empty content array is rejected by the API, so only continue
            # the loop when at least one client-side tool actually ran.
            if not tool_results:
                break
            api_messages.append({"role": "user", "content": tool_results})
    except anthropic.APIError as exc:
        db.rollback()
        logger.warning("assistant_api_error %s", kv(error=str(exc), user_id=user_id))
        raise HTTPException(status_code=502, detail="The AI service returned an error. Please try again.")

    if response is None:
        db.rollback()
        raise HTTPException(status_code=502, detail="The AI service returned no response. Please try again.")

    reply = "".join(getattr(b, "text", "") for b in response.content if b.type == "text").strip()
    if not reply:
        if pending_actions:
            reply = "Done."
        elif response.stop_reason == "refusal":
            reply = "I can't help with that particular request. Try rephrasing it, or ask me something else."
        else:
            reply = "I'm not sure how to help with that — could you rephrase?"

    reply = reply[:MAX_REPLY_CHARS]

    usage_summary = _price_usage(usage_totals, model)
    # A cache_hit_rate near zero on a long conversation means the prefix is being
    # invalidated — the cheapest possible signal that the layout has regressed.
    logger.info(
        "assistant_turn %s",
        kv(
            user_id=user_id,
            tier=tier_name,
            model=model,
            cache_hit_pct=usage_summary["cache_hit_rate_pct"],
            cost_usd=usage_summary["estimated_cost_usd"],
            searches=usage_summary["web_searches"],
        ),
    )

    # Persist this turn (user message + assistant reply text only).
    try:
        if conv is None:
            conv = AssistantConversation(user_id=user_id, title=message[:60])
            db.add(conv)
            db.flush()
        db.add(AssistantMessage(conversation_id=conv.id, user_id=user_id, role="user", content=message))
        db.add(AssistantMessage(conversation_id=conv.id, user_id=user_id, role="assistant", content=reply))
        conv.updated_at = utc_now()
        db.flush()
        _prune_conversation_messages(db, conv.id)
        db.commit()
    except Exception:
        db.rollback()
        raise

    for action in pending_actions:
        action["action_token"] = _register_pending_action(
            user_id,
            conv.id,
            action["tool"],
            action["input"],
        )

    return {
        "conversation_id": conv.id,
        "title": conv.title,
        "reply": reply,
        "pending_actions": pending_actions,
        "visual_blocks": visual_blocks[-4:],
        "sources": sources[:8],
        "tier": tier_name,
        "usage": usage_summary,
    }


@router.post("/execute")
@limiter.limit("30/minute")
def execute_action(
    req: ExecuteRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Run a write action the user has confirmed."""
    del request
    action = _consume_pending_action(req.action_token, current_user.id, req.conversation_id)
    if req.tool != action["tool"] or req.input != action["input"]:
        raise HTTPException(status_code=400, detail="Pending action payload does not match")
    tool, inp = action["tool"], action["input"]
    if tool not in WRITE_TOOLS:
        raise HTTPException(status_code=400, detail=f"'{tool}' is not an executable action")

    if tool == "add_transaction":
        account = db.query(Account).filter(Account.id == inp.get("account_id"), Account.user_id == current_user.id).first()
        if not account:
            raise HTTPException(status_code=404, detail="Account not found")
        amount = abs(_num(inp.get("amount")))
        if amount == 0:
            raise HTTPException(status_code=400, detail="amount must be greater than zero")
        direction = inp.get("direction")
        if direction not in {"income", "expense"}:
            raise HTTPException(status_code=400, detail="direction must be income or expense")
        signed = amount if direction == "income" else -amount
        category_id = None
        if inp.get("category"):
            category_name = _clean_text(inp["category"], "category", 100)
            cat = (
                db.query(Category)
                .filter(func.lower(Category.name) == category_name.lower())
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
            description=_clean_text(inp.get("description"), "description", 500, required=False),
            transaction_date=tx_date,
        )
        db.add(tx)
        account.balance = Account.balance + signed
        db.commit()
        message = "Transaction recorded."

    elif tool == "add_account":
        account_type = inp.get("type")
        if account_type not in {"checking", "savings", "credit_card", "cash", "investment"}:
            raise HTTPException(status_code=400, detail="Invalid account type")
        acc = Account(
            user_id=current_user.id,
            name=_clean_text(inp.get("name"), "name", 100),
            type=account_type,
            balance=_num(inp.get("balance", 0)),
        )
        db.add(acc)
        db.commit()
        message = "Account created."

    elif tool == "add_savings_goal":
        target_amount = _num(inp.get("target_amount"))
        if target_amount <= 0:
            raise HTTPException(status_code=400, detail="target_amount must be greater than zero")
        goal = SavingsGoal(
            user_id=current_user.id,
            name=_clean_text(inp.get("name"), "name", 100),
            target_amount=target_amount,
            deadline=_parse_date(inp.get("deadline")),
        )
        db.add(goal)
        db.commit()
        message = "Savings goal created."

    elif tool == "add_loan":
        loan_amount = _num(inp.get("amount"))
        if loan_amount <= 0:
            raise HTTPException(status_code=400, detail="amount must be greater than zero")
        loan = Loan(
            user_id=current_user.id,
            borrower_name=_clean_text(inp.get("borrower_name"), "borrower_name", 100),
            amount=loan_amount,
            note=_clean_text(inp.get("note"), "note", 1000, required=False),
            loan_date=_parse_date(inp.get("loan_date")) or _user_today(current_user),
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
        conv.updated_at = utc_now()
        db.commit()

    return {"success": True, "message": message}
