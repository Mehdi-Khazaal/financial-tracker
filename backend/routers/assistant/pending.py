"""Pending-action tokens: a proposed write waits here until the user confirms."""

import secrets
from time import monotonic
from typing import Optional

from fastapi import HTTPException

from routers.assistant import (
    MAX_PENDING_ACTIONS,
    PENDING_ACTION_TTL_SECONDS,
    _pending_actions,
    _pending_actions_lock,
)


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
