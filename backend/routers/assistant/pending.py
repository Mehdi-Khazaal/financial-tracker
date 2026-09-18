"""Pending-action tokens: a proposed write waits here until the user confirms.

Rows live in `assistant_pending_actions` (revision 20260917_000017). The
client receives a random token; the row stores its SHA-256, the owner, the
conversation, the tool and its input, and an expiry. Confirmation consumes
the row exactly once — the `consumed_at IS NULL` guard on the update is what
makes a double-tap or two workers racing execute the write only one time.

`400` means the token is unknown, expired or already used; `404` means it
exists but belongs to someone else or to another conversation — the same
distinction the process-memory version drew, and what the tests pin.
"""

from __future__ import annotations

import hashlib
import json
import secrets
from datetime import timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.database import AssistantPendingAction, utc_now
from routers.assistant import PENDING_ACTION_TTL_SECONDS


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _register_pending_action(
    db: Session, user_id: int, conversation_id: Optional[int], tool: str, tool_input: dict
) -> str:
    token = secrets.token_urlsafe(32)
    db.add(
        AssistantPendingAction(
            token_hash=_token_hash(token),
            user_id=user_id,
            conversation_id=conversation_id,
            tool=tool,
            input=json.dumps(tool_input, default=str),
            expires_at=utc_now() + timedelta(seconds=PENDING_ACTION_TTL_SECONDS),
        )
    )
    db.commit()
    return token


def _consume_pending_action(db: Session, token: str, user_id: int, conversation_id: Optional[int]) -> dict:
    now = utc_now()
    row = (
        db.query(AssistantPendingAction)
        .filter(AssistantPendingAction.token_hash == _token_hash(token))
        .first()
    )
    if row is None or row.consumed_at is not None or row.expires_at <= now:
        raise HTTPException(status_code=400, detail="Pending action is invalid or expired")
    if row.user_id != user_id or row.conversation_id != conversation_id:
        raise HTTPException(status_code=404, detail="Pending action not found")

    consumed = (
        db.query(AssistantPendingAction)
        .filter(AssistantPendingAction.id == row.id, AssistantPendingAction.consumed_at.is_(None))
        .update({"consumed_at": now}, synchronize_session=False)
    )
    db.commit()
    if consumed != 1:
        raise HTTPException(status_code=400, detail="Pending action is invalid or expired")
    return {
        "user_id": row.user_id,
        "conversation_id": row.conversation_id,
        "tool": row.tool,
        "input": json.loads(row.input or "{}"),
    }


def prune_expired_pending_actions(db: Session, *, now=None) -> int:
    """Delete consumed and expired rows. Returns how many went."""
    now = now or utc_now()
    deleted = (
        db.query(AssistantPendingAction)
        .filter(
            (AssistantPendingAction.expires_at <= now)
            | (AssistantPendingAction.consumed_at.isnot(None))
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    return deleted
