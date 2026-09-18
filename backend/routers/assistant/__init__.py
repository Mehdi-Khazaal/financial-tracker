"""AI financial assistant — the package facade.

A chat agent over the user's data with persistent memory. Read tools execute
immediately against the signed-in user's ledger; every write, memory
included, is returned to the client as a *pending action* and only runs when
the user confirms it through `/execute`.

This module holds the configuration and the process-local pending-action
registry; the behaviour lives in the submodules and is re-exported here so
`routers.assistant.<name>` keeps working for callers and tests:

- `helpers`        JSON, date and text helpers, visual blocks
- `tools`          read + analytical tool implementations, READ/WRITE registries
- `routing`        tier selection (quick / standard / deep) and server tools
- `schemas`        tool schemas sent to Claude, request bodies, action summaries
- `prompt`         the cached system prompt and message assembly
- `pending`        confirmation tokens for proposed writes
- `usage`          token accounting and pricing
- `conversations`  conversation, memory and briefing routes
- `chat`           the `/chat` loop and `/execute`
"""

from decimal import Decimal

from fastapi import APIRouter

from utils.dates import clean_timezone, user_now, user_today
from utils.logging import get_logger

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


# ─── Time ────────────────────────────────────────────────────────────────────
# Thin aliases over `utils.dates`, the single date rule for the backend, so the
# assistant and the recurring scheduler cannot disagree about what day it is.
_clean_timezone = clean_timezone
_user_now = user_now
_user_today = user_today


# ─── Package assembly ─────────────────────────────────────────────────────────
# Imported after the configuration above so the submodules can bind to it.
from routers.assistant.helpers import (  # noqa: E402,F401
    _clean_text,
    _date_scope,
    _dump,
    _jsonable,
    _num,
    _parse_date,
    _visual_block_for_tool,
)
from routers.assistant.tools import (  # noqa: E402,F401
    MAX_MEMORIES,
    MAX_MEMORY_CHARS,
    READ_TOOLS,
    WRITE_TOOLS,
    _add_months,
    _average_monthly,
    _month_floor,
    _monthly_flows,
    _save_memory,
    _t_affordability_check,
    _t_analyze_portfolio,
    _t_analyze_spending_trends,
    _t_cashflow_trend,
    _t_financial_health,
    _t_find_recurring_waste,
    _t_get_overview,
    _t_list_accounts,
    _t_list_assets,
    _t_list_loans,
    _t_list_recurring,
    _t_list_savings_goals,
    _t_list_transactions,
    _t_project_savings_goals,
    _t_simulate_scenario,
    _t_spending_by_category,
    _untrusted_tool_result,
)
from routers.assistant.routing import (  # noqa: E402,F401
    QUICK_TOOL_NAMES,
    _DEEP_SIGNALS,
    _DEPTH_OVERRIDES,
    _QUICK_MAX_CHARS,
    _QUICK_SIGNALS,
    _route_request,
    _server_tools,
)
from routers.assistant.schemas import (  # noqa: E402,F401
    ChatRequest,
    ExecuteRequest,
    _action_summary,
    _all_tool_schemas,
    _tool_schemas,
)
from routers.assistant.prompt import (  # noqa: E402,F401
    _STABLE_SYSTEM_PROMPT,
    _assemble_messages,
    _build_system_blocks,
    _live_context_text,
)
from routers.assistant.pending import _consume_pending_action, _register_pending_action  # noqa: E402,F401
from routers.assistant.usage import _accumulate_usage, _collect_sources, _price_usage  # noqa: E402,F401
from routers.assistant.conversations import (  # noqa: E402,F401
    _get_conversation,
    _prune_conversation_messages,
    router as _conversations_router,
)
from routers.assistant.chat import router as _chat_router  # noqa: E402

router = APIRouter(prefix="/assistant", tags=["assistant"])
router.include_router(_conversations_router)
router.include_router(_chat_router)
