"""Token accounting, pricing, and citation collection for one turn."""

from decimal import Decimal

from routers.assistant import CACHE_READ_MULTIPLIER, CACHE_WRITE_MULTIPLIER, MODEL, MODEL_PRICING
from utils.logging import get_logger, kv

logger = get_logger(__name__)


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
