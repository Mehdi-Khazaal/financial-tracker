"""Tool schemas sent to Claude, request bodies, and confirmation summaries."""

import json
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from routers.assistant import MAX_MESSAGE_CHARS


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
            "description": "Get a snapshot of the user's finances: liquid balance, credit card balances, assets, loans owed, and estimated net worth (all of those combined, with card debt subtracted).",
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
                    "search": {"type": "string", "description": "Text to match in the description or merchant name (case-insensitive)"},
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
            "name": "list_budgets",
            "description": (
                "Every monthly budget with the amount, what has been spent this month, what is "
                "left, and whether it is over. Use for any question about budgets, allowances, "
                "or whether spending in a category is on track."
            ),
            "input_schema": {
                "type": "object",
                "properties": {"month": {"type": "string", "description": "YYYY-MM; defaults to the current month."}},
            },
        },
        {
            "name": "list_rules",
            "description": (
                "The user's automatic categorization rules — 'anything containing X is filed "
                "under Y' — with priority, whether each is active, and how many transactions "
                "each has filed. Use for questions about why something was categorized a "
                "certain way or what rules exist."
            ),
            "input_schema": {"type": "object", "properties": {}},
        },
        {
            "name": "get_alert_settings",
            "description": (
                "Which alerts are on (bill reminders, budget alerts, low-balance alerts and its "
                "threshold), which accounts are currently below that threshold, and whether "
                "automatic categorization is on. Read-only: alerts are changed in Settings."
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
            "name": "set_budget",
            "description": (
                "Propose a monthly budget for one expense category, or change an existing one. "
                "Shown to the user for confirmation; not executed automatically. Call list_budgets "
                "first to see what exists, and use the category's exact name."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "description": "Name of an existing expense category"},
                    "amount": {"type": "number", "description": "Monthly allowance, positive"},
                    "rollover": {"type": "boolean", "description": "Carry unspent money into next month (overspending never carries)"},
                },
                "required": ["category", "amount"],
            },
        },
        {
            "name": "add_rule",
            "description": (
                "Propose a categorization rule: transactions whose description (or merchant) contains "
                "the text are filed under the category automatically from now on. Optionally also "
                "files matching past transactions, never ones the user categorized by hand. Shown "
                "for confirmation; not executed automatically. Call list_rules first to avoid duplicates."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Text to look for, e.g. 'netflix'"},
                    "category": {"type": "string", "description": "Name of an existing category"},
                    "field": {"type": "string", "enum": ["description", "merchant"]},
                    "apply_to_past": {"type": "boolean", "description": "Also file matching past transactions"},
                },
                "required": ["pattern", "category"],
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
    if tool == "set_budget":
        rollover = " with rollover" if inp.get("rollover") else ""
        return f"Budget {inp.get('amount')} a month for \"{inp.get('category')}\"{rollover}"
    if tool == "add_rule":
        past = ", and file matching past transactions" if inp.get("apply_to_past") else ""
        where = "merchant" if inp.get("field") == "merchant" else "description"
        return f"File transactions whose {where} contains \"{inp.get('pattern')}\" under \"{inp.get('category')}\"{past}"
    if tool == "save_memory":
        content = str(inp.get("content") or "").strip()
        return f"Remember: \"{content[:200]}{'…' if len(content) > 200 else ''}\""
    return tool


# Everything in here is byte-stable across requests, so it sits ahead of the
# cache breakpoint. Nothing user-specific or time-varying may go in this string.


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
