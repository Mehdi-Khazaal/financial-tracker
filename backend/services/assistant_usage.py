"""Per-user assistant usage: daily turn and cost caps, and the admin view.

Every chat turn costs real money. With more than one user the service needs
a ceiling per person per day, enforced *before* the model is called, and a
record an admin can read. Both come from one small table with one row per
(user, day).

Caps are environment settings so they can be tuned without a deploy:
`ASSISTANT_DAILY_TURN_CAP` (default 150) and `ASSISTANT_DAILY_COST_CAP_USD`
(default 3.00). A cap of 0 disables that limit. "Day" is the user's own
calendar day so the reset happens at their midnight, not the server's.
"""

from __future__ import annotations

import os
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from models.auth import User
from models.database import AssistantUsageDaily
from utils.dates import user_today


def _decimal_env(name: str, default: str) -> Decimal:
    try:
        return Decimal(os.getenv(name, "") or default)
    except (ArithmeticError, ValueError):
        return Decimal(default)


def turn_cap() -> int:
    try:
        return max(0, int(os.getenv("ASSISTANT_DAILY_TURN_CAP", "") or 150))
    except ValueError:
        return 150


def cost_cap() -> Decimal:
    return max(Decimal("0"), _decimal_env("ASSISTANT_DAILY_COST_CAP_USD", "3.00"))


def _row(db: Session, user_id: int, day: date) -> Optional[AssistantUsageDaily]:
    return (
        db.query(AssistantUsageDaily)
        .filter(AssistantUsageDaily.user_id == user_id, AssistantUsageDaily.day == day)
        .first()
    )


def usage_today(db: Session, user: User) -> dict:
    row = _row(db, user.id, user_today(user))
    return {
        "turns": row.turns if row else 0,
        "cost_usd": Decimal(str(row.cost_usd)) if row else Decimal("0"),
        "turn_cap": turn_cap(),
        "cost_cap_usd": cost_cap(),
    }


def enforce_caps(db: Session, user: User) -> None:
    """Raise 429 when today's usage is already at either cap."""
    current = usage_today(db, user)
    if current["turn_cap"] and current["turns"] >= current["turn_cap"]:
        raise HTTPException(
            status_code=429,
            detail=f"Daily assistant limit reached ({current['turn_cap']} messages). It resets at midnight.",
        )
    if current["cost_cap_usd"] and current["cost_usd"] >= current["cost_cap_usd"]:
        raise HTTPException(
            status_code=429,
            detail="Daily assistant budget reached. It resets at midnight.",
        )


def record_turn(db: Session, user: User, cost_usd) -> None:
    """Add one turn and its estimated cost to today's row. Commits."""
    day = user_today(user)
    row = _row(db, user.id, day)
    if row is None:
        row = AssistantUsageDaily(user_id=user.id, day=day, turns=0, cost_usd=Decimal("0"))
        db.add(row)
    row.turns = (row.turns or 0) + 1
    row.cost_usd = Decimal(str(row.cost_usd or 0)) + Decimal(str(cost_usd or 0))
    db.commit()


def admin_summary(db: Session, *, days: int = 30, today: Optional[date] = None) -> list[dict]:
    """Per-user turns and cost over the window, most expensive first."""
    today = today or date.today()
    since = today - timedelta(days=max(0, days - 1))
    rows = (
        db.query(
            AssistantUsageDaily.user_id,
            User.username,
            User.email,
            func.coalesce(func.sum(AssistantUsageDaily.turns), 0),
            func.coalesce(func.sum(AssistantUsageDaily.cost_usd), 0),
            func.max(AssistantUsageDaily.day),
        )
        .join(User, User.id == AssistantUsageDaily.user_id)
        .filter(AssistantUsageDaily.day >= since)
        .group_by(AssistantUsageDaily.user_id, User.username, User.email)
        .all()
    )
    out = [
        {
            "user_id": user_id,
            "username": username,
            "email": email,
            "turns": int(turns),
            "cost_usd": Decimal(str(cost)).quantize(Decimal("0.000001")),
            "last_active": last_day,
        }
        for user_id, username, email, turns, cost, last_day in rows
    ]
    out.sort(key=lambda r: (-r["cost_usd"], -r["turns"]))
    return out
