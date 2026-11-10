"""Net worth: one definition for every screen, the history and the assistant.

    net worth = account balances + holdings

* **Account balances** are every account except `investment`-type ones, with
  credit cards counting negative because that is how they are stored. Cash in
  an investment-type account is left out because the holdings it bought are
  already counted below, and counting both would count the same money twice.
* **Holdings** are every asset at its current value (see `services.valuation`):
  a market price where one is stored, otherwise what was recorded.

History uses the same two parts. Past months take each account's month-end
balance and every holding acquired by that month's end at its recorded value
(no past market prices are stored). The month in progress takes today's
balances and today's valuation, so the last point of every chart is the same
number the screen shows as "now".

Money lent to other people is not part of net worth. It is reported beside it
(see the Loans tab and the assistant), because whether it comes back is not
certain.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Iterable

from sqlalchemy.orm import Session

from models.database import Account, Asset
from services.market_prices import RefreshMode
from services.valuation import value_holdings

ZERO = Decimal("0")

# Account types whose balances are not part of net worth.
EXCLUDED_ACCOUNT_TYPES = frozenset({"investment"})


def counts_toward_net_worth(account: Account) -> bool:
    return account.type not in EXCLUDED_ACCOUNT_TYPES


def accounts_total(accounts: Iterable[Account]) -> Decimal:
    """Sum of balances that count toward net worth. Cards are already negative."""
    return sum(
        (Decimal(str(a.balance or 0)) for a in accounts if counts_toward_net_worth(a)),
        ZERO,
    )


def acquired_on(asset: Asset) -> date:
    """The day a holding started counting: its purchase date, else when it was added."""
    if asset.purchase_date is not None:
        return asset.purchase_date
    if asset.created_at is not None:
        return asset.created_at.date()
    return date.min


def holdings_recorded_by(assets: Iterable[Asset], day: date) -> Decimal:
    """Recorded value of every holding acquired on or before `day`."""
    return sum(
        (Decimal(str(a.total_value or 0)) for a in assets if acquired_on(a) <= day),
        ZERO,
    )


@dataclass(frozen=True)
class NetWorth:
    accounts: Decimal
    holdings: Decimal

    @property
    def total(self) -> Decimal:
        return self.accounts + self.holdings


def current_net_worth(db: Session, user_id: int, refresh: RefreshMode = "missing") -> NetWorth:
    accounts = db.query(Account).filter(Account.user_id == user_id).all()
    valuation = value_holdings(db, user_id, refresh=refresh)
    return NetWorth(accounts=accounts_total(accounts), holdings=valuation.total)
