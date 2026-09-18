"""The chat loop and the confirmed-write executor."""

import os

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from models.auth import User
from models.database import (
    Account,
    AssistantConversation,
    AssistantMessage,
    Category,
    Loan,
    SavingsGoal,
    get_db,
    utc_now,
)
from routers.assistant import (
    MAX_CONVERSATIONS,
    MAX_HISTORY_MESSAGES,
    MAX_PAUSE_RESUMES,
    MAX_REPLY_CHARS,
    MAX_TOKENS,
    MAX_TOOL_ITERATIONS,
    TIERS,
    _clean_timezone,
    _user_today,
)
from routers.assistant.helpers import _clean_text, _dump, _num, _parse_date, _visual_block_for_tool
from routers.assistant.pending import _consume_pending_action, _register_pending_action
from routers.assistant.prompt import _assemble_messages, _build_system_blocks, _live_context_text
from routers.assistant.routing import QUICK_TOOL_NAMES, _route_request, _server_tools
from routers.assistant.schemas import ChatRequest, ExecuteRequest, _action_summary, _tool_schemas
from routers.assistant.tools import READ_TOOLS, WRITE_TOOLS, _save_memory, _untrusted_tool_result
from routers.assistant.conversations import _get_conversation, _prune_conversation_messages
from routers.assistant.usage import _accumulate_usage, _collect_sources, _price_usage
from services.ledger import LedgerResourceNotFound, LedgerService
from utils.auth import get_current_user
from utils.limiter import limiter
from utils.logging import get_logger, kv

router = APIRouter()
logger = get_logger(__name__)


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
                        result_str = _untrusted_tool_result(name, _dump(tool_result))
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
        # Same path as a hand-entered transaction: ownership, enrichment and
        # an atomic balance update all come from the ledger service.
        try:
            LedgerService(db).stage_transaction(
                current_user.id,
                {
                    "account_id": account.id,
                    "category_id": category_id,
                    "amount": signed,
                    "description": _clean_text(inp.get("description"), "description", 500, required=False),
                    "transaction_date": tx_date,
                },
            )
            db.commit()
        except LedgerResourceNotFound as error:
            db.rollback()
            raise HTTPException(status_code=404, detail=error.detail) from error
        except Exception:
            db.rollback()
            raise
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

    elif tool == "save_memory":
        message = _save_memory(db, current_user, inp.get("content"))

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
