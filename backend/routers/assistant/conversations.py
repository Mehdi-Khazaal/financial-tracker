"""Conversation, memory and briefing routes."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from models.auth import User
from models.database import AssistantConversation, AssistantMemory, AssistantMessage, get_db
from routers.assistant import MAX_LISTED_CONVERSATIONS, MAX_REPLY_CHARS, MAX_STORED_MESSAGES, _clean_timezone, _user_today
from routers.assistant.helpers import _jsonable, _visual_block_for_tool
from routers.assistant.tools import _t_get_overview, _t_list_transactions, _t_spending_by_category
from utils.auth import get_current_user

router = APIRouter()


def _get_conversation(db: Session, user: User, conversation_id: int) -> AssistantConversation:
    conv = (
        db.query(AssistantConversation)
        .filter(AssistantConversation.id == conversation_id, AssistantConversation.user_id == user.id)
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


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
