"""Market prices, stored so every screen and the assistant quote the same one.

Before this module a price existed only in the browser. Portfolio fetched each
ticker and kept it in localStorage, the Dashboard made no market calls and so
valued every holding at what it was recorded at, and the assistant only knew
recorded values. One holding, three different values, depending on where you
looked.

Prices are now fetched on the server and kept in `market_prices`: one row per
symbol, shared by every user, because a quote is public data. A reader takes
the stored row and decides what to do when it is missing or old:

* ``"never"``   — use whatever is stored, never wait on the network. For
  history and anything that must answer instantly.
* ``"missing"`` — fetch only symbols that have no stored price at all. Old
  prices are used as they are; the caller can refresh them afterwards.
* ``"stale"``   — fetch anything missing or older than `FRESH_FOR`.
* ``"always"``  — fetch every symbol now. The Portfolio "Refresh" button.

A failed lookup never erases a stored price: the last good value stays, with
its `fetched_at`, so a caller can say how old it is instead of showing nothing.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Iterable, Literal, Optional

import requests
import yfinance as yf
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.database import MarketPrice, utc_now
from utils.logging import get_logger, kv

logger = get_logger(__name__)

FRESH_FOR = timedelta(minutes=15)
FETCH_WORKERS = 4

RefreshMode = Literal["never", "missing", "stale", "always"]

CRYPTO_SYMBOLS = {
    'BTC': 'bitcoin', 'ETH': 'ethereum', 'BNB': 'binancecoin', 'SOL': 'solana',
    'XRP': 'ripple', 'ADA': 'cardano', 'DOGE': 'dogecoin', 'AVAX': 'avalanche-2',
    'DOT': 'polkadot', 'MATIC': 'matic-network', 'LTC': 'litecoin',
    'SHIB': 'shiba-inu', 'TRX': 'tron', 'UNI': 'uniswap', 'LINK': 'chainlink',
    'TON': 'the-open-network', 'USDT': 'tether', 'USDC': 'usd-coin',
}


# ─── Network lookups ──────────────────────────────────────────────────────────
def fetch_crypto_price(symbol: str) -> float | None:
    """CoinGecko's free API, no key required."""
    sym = symbol.upper().replace('-USD', '')
    coin_id = CRYPTO_SYMBOLS.get(sym)
    if not coin_id:
        try:
            r = requests.get(f"https://api.coingecko.com/api/v3/search?query={sym}", timeout=8)
            r.raise_for_status()
            coins = r.json().get('coins', [])
            if not coins:
                return None
            coin_id = coins[0]['id']
        except Exception:
            return None
    try:
        r = requests.get(
            f"https://api.coingecko.com/api/v3/simple/price?ids={coin_id}&vs_currencies=usd",
            timeout=8,
        )
        r.raise_for_status()
        price = r.json().get(coin_id, {}).get('usd')
        return round(float(price), 6) if price else None
    except Exception:
        return None


def fetch_stock_price(symbol: str) -> tuple[float | None, float]:
    """Last price and day change from yfinance, which handles Yahoo's sessions."""
    try:
        info = yf.Ticker(symbol).fast_info
        price = getattr(info, 'last_price', None) or getattr(info, 'regular_market_price', None)
        if price:
            prev_close = getattr(info, 'previous_close', None) or getattr(info, 'regular_market_previous_close', None)
            change_pct = ((price - prev_close) / prev_close * 100) if prev_close else 0.0
            return round(float(price), 4), round(float(change_pct), 2)
    except Exception as exc:
        logger.info("stock_quote_lookup_failed %s", kv(symbol=symbol, error_type=type(exc).__name__))
        return None, 0.0
    return None, 0.0


def stock_key(symbol: str) -> str:
    return f"stock:{symbol.upper()}"


def crypto_key(symbol: str) -> str:
    return f"crypto:{symbol.upper()}"


def fetch_for_key(key: str) -> tuple[Decimal, Optional[Decimal]] | None:
    """Look one stored key up on the network. None when no source has a price."""
    kind, _, symbol = key.partition(":")
    if not symbol:
        return None
    if kind == "crypto":
        price = fetch_crypto_price(symbol)
        if price:
            return Decimal(str(price)), None
        price, change = fetch_stock_price(f"{symbol}-USD")
        return (Decimal(str(price)), Decimal(str(change))) if price else None
    if kind == "stock":
        price, change = fetch_stock_price(symbol)
        return (Decimal(str(price)), Decimal(str(change))) if price else None
    return None


# ─── Stored quotes ────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Quote:
    key: str
    price: Decimal
    change_pct: Optional[Decimal]
    fetched_at: datetime

    def is_fresh(self, now: datetime) -> bool:
        return now - self.fetched_at <= FRESH_FOR


def _as_quote(row: MarketPrice) -> Quote:
    return Quote(
        key=row.key,
        price=Decimal(str(row.price)),
        change_pct=Decimal(str(row.change_pct)) if row.change_pct is not None else None,
        fetched_at=row.fetched_at,
    )


def stored_quotes(db: Session, keys: Iterable[str]) -> dict[str, Quote]:
    wanted = sorted(set(keys))
    if not wanted:
        return {}
    rows = db.query(MarketPrice).filter(MarketPrice.key.in_(wanted)).all()
    return {row.key: _as_quote(row) for row in rows}


def _store(db: Session, key: str, price: Decimal, change_pct: Optional[Decimal], at: datetime) -> None:
    row = db.get(MarketPrice, key)
    if row is None:
        db.add(MarketPrice(key=key, price=price, change_pct=change_pct, fetched_at=at))
    else:
        row.price = price
        row.change_pct = change_pct
        row.fetched_at = at
    try:
        db.commit()
    except IntegrityError:
        # Another request stored this symbol between our read and our write.
        # Its price is as good as ours; keep it.
        db.rollback()


def refresh_quotes(db: Session, keys: Iterable[str]) -> dict[str, Quote]:
    """Fetch `keys` from the network and store every price that came back.

    Lookups run in parallel (they are network-bound); writes happen afterwards
    on this session. A key that fails keeps its previous stored price.
    """
    wanted = sorted(set(keys))
    if wanted:
        with ThreadPoolExecutor(max_workers=min(FETCH_WORKERS, len(wanted))) as pool:
            results = list(pool.map(fetch_for_key, wanted))
        now = utc_now()
        for key, result in zip(wanted, results):
            if result is None:
                logger.info("market_price_unavailable %s", kv(key=key))
                continue
            price, change = result
            _store(db, key, price, change, now)
    return stored_quotes(db, wanted)


def keys_needing_refresh(quotes: dict[str, Quote], keys: Iterable[str], now: datetime) -> list[str]:
    """Keys that are missing or older than `FRESH_FOR`."""
    return sorted(k for k in set(keys) if k not in quotes or not quotes[k].is_fresh(now))


def get_quotes(db: Session, keys: Iterable[str], refresh: RefreshMode = "missing") -> dict[str, Quote]:
    """Stored quotes for `keys`, fetching first according to `refresh`."""
    wanted = set(keys)
    if not wanted:
        return {}
    quotes = stored_quotes(db, wanted)
    if refresh == "never":
        return quotes
    if refresh == "always":
        fetch = sorted(wanted)
    elif refresh == "stale":
        fetch = keys_needing_refresh(quotes, wanted, utc_now())
    else:
        fetch = sorted(wanted - quotes.keys())
    if fetch:
        quotes.update(refresh_quotes(db, fetch))
    return quotes
