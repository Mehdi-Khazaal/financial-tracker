"""Register background job handlers.

Importing this module wires each job kind to its handler function. `main.py`
imports it at boot so the dispatcher can find handlers on every request.
"""

from __future__ import annotations

from typing import Any, Dict

from sqlalchemy.orm import Session

from models.auth import User
from services import jobs, merchants
from services.balance_snapshots import refresh_snapshots_for_user
from utils.dates import user_today


def _refresh_all_snapshots(session: Session, payload: Dict[str, Any]) -> None:
    """Recompute month-end balance snapshots for every user, in their own zone."""
    for owner in session.query(User).all():
        refresh_snapshots_for_user(
            session, owner.id, months_back=24, include_today=True, today=user_today(owner)
        )


def _refresh_merchant_defaults(session: Session, payload: Dict[str, Any]) -> None:
    merchants.refresh_canonical_defaults(session)


jobs.register("snapshots.refresh_all", _refresh_all_snapshots)
jobs.register("merchants.refresh_defaults", _refresh_merchant_defaults)
