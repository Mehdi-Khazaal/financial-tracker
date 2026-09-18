"""Small pure helpers: JSON coercion, date scopes, visual blocks, input cleaning."""

import json
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import HTTPException

from models.database import utc_now


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
    return f"As of {(as_of or utc_now().date()).isoformat()}"


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
        scope = f"Last {len(result)} months through {(as_of or utc_now().date()).isoformat()}"
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
