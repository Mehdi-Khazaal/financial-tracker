"""What each holding is worth now, decided once on the server.

* **Metal.** A holding with a metal, a weight and a purity is worth its fine
  metal at today's price: `weight_grams × purity / 31.1034768` troy ounces per
  unit, times the price per ounce, times the quantity. Gold bought as coins,
  bars or jewelry used to sit at its purchase price forever; this is what a
  dealer would pay for the metal in it today (jewelry's making charge is not
  part of it, so a piece reads below what was paid for it, honestly).
* **Market.** A stock, ETF or coin whose ticker resolves is worth
  `price × quantity`.
* **Recorded.** Anything else is worth exactly what was recorded for it, never
  zero, and its change since recording is unknown rather than nothing.

Every screen and the assistant now read this one valuation, built from the
prices stored by `services.market_prices`, so a holding has one value
wherever it is shown.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from models.database import Asset
from services.market_prices import Quote, RefreshMode, crypto_key, get_quotes, metal_key, stock_key

ZERO = Decimal("0")
TROY_OUNCE_GRAMS = Decimal("31.1034768")

# Types the app has always looked up a market price for.
MARKET_TYPES = {"stock", "etf", "crypto"}

_BRACKETED = re.compile(r"\(([A-Z0-9]+)\)")
_BARE = re.compile(r"^[A-Z0-9]{1,10}$")


def ticker_of(name: Optional[str]) -> Optional[str]:
    """`Vanguard ETF (VTI)` → `VTI`; a bare `VTI` → `VTI`; anything else → None."""
    name = name or ""
    bracketed = _BRACKETED.search(name)
    if bracketed:
        return bracketed.group(1)
    trimmed = name.strip()
    return trimmed if _BARE.fullmatch(trimmed) else None


def fine_ounces_per_unit(asset: Asset) -> Optional[Decimal]:
    """Troy ounces of fine metal in one unit, or None unless metal pricing is set up."""
    if metal_key(asset.metal) is None or not asset.weight_grams or not asset.purity:
        return None
    return Decimal(str(asset.weight_grams)) * Decimal(str(asset.purity)) / TROY_OUNCE_GRAMS


def price_key(asset: Asset) -> Optional[str]:
    """The `market_prices` key that prices this holding, or None."""
    if fine_ounces_per_unit(asset) is not None:
        return metal_key(asset.metal)
    if (asset.type or "").lower() not in MARKET_TYPES:
        return None
    ticker = ticker_of(asset.name)
    if ticker is None:
        return None
    return crypto_key(ticker) if asset.type.lower() == "crypto" else stock_key(ticker)


def _decimal(value) -> Decimal:
    return Decimal(str(value)) if value is not None else ZERO


@dataclass(frozen=True)
class HoldingValue:
    asset_id: int
    asset_class: str
    recorded_value: Decimal
    current_value: Decimal
    # Market price per unit when priced, None otherwise.
    price_per_unit: Optional[Decimal]
    # "metal" or "market" when a stored price set the value, "recorded" when not.
    source: str
    priced_at: Optional[datetime]
    # Price per troy ounce, for a holding priced by its metal.
    spot_price: Optional[Decimal] = None

    @property
    def change_since_recorded(self) -> Optional[Decimal]:
        if self.source == "recorded":
            return None
        return self.current_value - self.recorded_value


@dataclass(frozen=True)
class HoldingsValuation:
    holdings: list[HoldingValue] = field(default_factory=list)

    @property
    def total(self) -> Decimal:
        return sum((h.current_value for h in self.holdings), ZERO)

    @property
    def recorded_total(self) -> Decimal:
        return sum((h.recorded_value for h in self.holdings), ZERO)

    @property
    def priced_count(self) -> int:
        return sum(1 for h in self.holdings if h.source != "recorded")

    @property
    def as_of(self) -> Optional[datetime]:
        """When the oldest price in use was fetched: the honest "prices as of"."""
        times = [h.priced_at for h in self.holdings if h.priced_at is not None]
        return min(times) if times else None

    def total_for(self, asset_class: str) -> Decimal:
        return sum((h.current_value for h in self.holdings if h.asset_class == asset_class), ZERO)


def value_asset(asset: Asset, quotes: dict[str, Quote]) -> HoldingValue:
    recorded = _decimal(asset.total_value)
    quantity = _decimal(asset.quantity) if asset.quantity is not None else Decimal("1")
    key = price_key(asset)
    quote = quotes.get(key) if key else None
    ounces = fine_ounces_per_unit(asset)
    if quote is not None and ounces is not None:
        per_unit = (ounces * quote.price).quantize(Decimal("0.01"))
        return HoldingValue(
            asset_id=asset.id,
            asset_class=asset.asset_class or "physical",
            recorded_value=recorded,
            current_value=(ounces * quote.price * quantity).quantize(Decimal("0.01")),
            price_per_unit=per_unit,
            source="metal",
            priced_at=quote.fetched_at,
            spot_price=quote.price,
        )
    if quote is not None:
        return HoldingValue(
            asset_id=asset.id,
            asset_class=asset.asset_class or "physical",
            recorded_value=recorded,
            current_value=(quote.price * quantity).quantize(Decimal("0.01")),
            price_per_unit=quote.price,
            source="market",
            priced_at=quote.fetched_at,
        )
    return HoldingValue(
        asset_id=asset.id,
        asset_class=asset.asset_class or "physical",
        recorded_value=recorded,
        current_value=recorded,
        price_per_unit=None,
        source="recorded",
        priced_at=None,
    )


def value_assets(assets: Iterable[Asset], quotes: dict[str, Quote]) -> HoldingsValuation:
    return HoldingsValuation(holdings=[value_asset(a, quotes) for a in assets])


def price_keys(assets: Iterable[Asset]) -> set[str]:
    return {key for key in (price_key(a) for a in assets) if key}


def value_holdings(db: Session, user_id: int, refresh: RefreshMode = "missing") -> HoldingsValuation:
    """Every holding the user has, valued with stored prices."""
    assets = db.query(Asset).filter(Asset.user_id == user_id).order_by(Asset.id).all()
    quotes = get_quotes(db, price_keys(assets), refresh=refresh)
    return value_assets(assets, quotes)
