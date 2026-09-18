"""Which tier answers a question, and which server-side tools ride along."""

from models.auth import User
from routers.assistant import WEB_SEARCH_MAX_USES, _clean_timezone


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
    "list_budgets",
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
