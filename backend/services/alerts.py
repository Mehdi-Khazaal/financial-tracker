"""Low-balance alerts.

One rule: **once per dip.** An account whose balance falls below the user's
threshold is announced once, and not again until the balance has climbed
back over the line and fallen below it a second time. A nightly repeat of
"your balance is low" for a balance that stayed low teaches people to turn
the alert off, which is worse than never having sent it.

The state is one nullable date on the account: set when the alert goes out,
cleared when a later check finds the balance recovered. Both the nightly cron
and the post-sync hook call `check_low_balances`; running it any number of
times a day sends nothing new.

Only accounts that hold money are watched — checking, savings, cash. A credit
card's balance is what is owed, and an investment balance moves with the
market; neither is a "running out of money" signal.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from models.auth import User
from models.database import Account
from services import user_preferences
from utils.dates import user_today
from utils.logging import get_logger, kv

logger = get_logger(__name__)

WATCHED_ACCOUNT_TYPES = ("checking", "savings", "cash")
CENTS = Decimal("0.01")


def _money(value: Decimal) -> str:
    return f"${abs(value):,.2f}"


def check_low_balances(db: Session, user: User, send) -> int:
    """Send low-balance pushes for this user's accounts. Returns how many.

    `send(db, user_id, title, body, url, tag)` is injected so the caller
    decides delivery. Marks before sending so a delivery failure is not
    retried every night.
    """
    values = user_preferences.stored_values(db, user.id)
    threshold = Decimal(str(values["low_balance_threshold"])).quantize(CENTS)
    accounts = (
        db.query(Account)
        .filter(Account.user_id == user.id, Account.type.in_(WATCHED_ACCOUNT_TYPES))
        .all()
    )
    sent = 0
    today = user_today(user)
    for account in accounts:
        balance = Decimal(str(account.balance or 0)).quantize(CENTS)
        if balance >= threshold:
            # Recovered (or never low): re-arm so the next dip is announced.
            if account.low_balance_notified_on is not None:
                account.low_balance_notified_on = None
            continue
        if account.low_balance_notified_on is not None:
            continue
        if not values["low_balance_alerts_enabled"]:
            # Off: nothing is sent and nothing is marked, so switching it on
            # announces anything currently low on the next check.
            continue
        account.low_balance_notified_on = today
        db.commit()
        body = (
            f"{_money(balance)} left, below your {_money(threshold)} threshold."
            if balance >= 0 else
            f"Overdrawn by {_money(balance)}."
        )
        send(
            db,
            user.id,
            f"Low balance: {account.name}",
            body,
            url="/accounts",
            tag=f"low-balance-{account.id}",
        )
        sent += 1
    db.commit()
    if sent:
        logger.info("low_balance_alerts_sent %s", kv(user_id=user.id, count=sent))
    return sent


def check_all_low_balances(db: Session, send) -> dict:
    """Every user with the alert switched on. Used by the nightly cron."""
    from models.database import UserPreferences

    user_ids = [
        row[0] for row in db.query(UserPreferences.user_id)
        .filter(UserPreferences.low_balance_alerts_enabled.is_(True))
        .all()
    ]
    sent = 0
    for user_id in user_ids:
        owner = db.query(User).filter(User.id == user_id).first()
        if owner is None:
            continue
        try:
            sent += check_low_balances(db, owner, send)
        except Exception:
            db.rollback()
            logger.exception("low_balance_check_failed %s", kv(user_id=user_id))
    return {"users": len(user_ids), "alerts": sent}
