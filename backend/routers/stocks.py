import re
from collections import OrderedDict
from threading import Lock
from time import time

from fastapi import APIRouter, Depends, HTTPException, Request

from models.auth import User
from services.market_prices import (
    CRYPTO_SYMBOLS,
    fetch_crypto_price as _get_crypto_price,
    fetch_stock_price as _get_stock_price,
)
from utils.auth import get_current_user
from utils.limiter import limiter
from utils.logging import get_logger

router = APIRouter(prefix="/stocks", tags=["stocks"])
logger = get_logger(__name__)

PRICE_CACHE_TTL_SECONDS = 120
PRICE_CACHE_MAX_ENTRIES = 512
SYMBOL_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9.^-]{0,14}$")
_price_cache: OrderedDict[str, tuple[float, dict]] = OrderedDict()
_price_cache_lock = Lock()


def _get_cached_quote(symbol: str):
    with _price_cache_lock:
        cached = _price_cache.get(symbol)
        if not cached:
            return None
        cached_at, payload = cached
        if time() - cached_at > PRICE_CACHE_TTL_SECONDS:
            _price_cache.pop(symbol, None)
            return None
        _price_cache.move_to_end(symbol)
        return payload


def _store_cached_quote(symbol: str, payload: dict):
    with _price_cache_lock:
        _price_cache[symbol] = (time(), payload)
        _price_cache.move_to_end(symbol)
        while len(_price_cache) > PRICE_CACHE_MAX_ENTRIES:
            _price_cache.popitem(last=False)
    return payload


@router.get("/{symbol}")
@limiter.limit("60/minute")
def get_stock_price(
    request: Request,
    symbol: str,
    current_user: User = Depends(get_current_user),
):
    del current_user
    raw_symbol = symbol.upper()
    cache_key = raw_symbol.strip()
    if cache_key != raw_symbol:
        raise HTTPException(status_code=422, detail="Invalid stock symbol")
    if not SYMBOL_PATTERN.fullmatch(cache_key):
        raise HTTPException(status_code=422, detail="Invalid stock symbol")
    sym = cache_key.removesuffix('-USD')
    cached = _get_cached_quote(cache_key)
    if cached is not None:
        return cached

    # Crypto: use CoinGecko
    if sym in CRYPTO_SYMBOLS or symbol.upper().endswith('-USD'):
        price = _get_crypto_price(sym)
        if price:
            return _store_cached_quote(cache_key, {"symbol": symbol, "price": price, "change_pct": 0})
        # If CoinGecko fails, try yfinance with -USD suffix
        price, change_pct = _get_stock_price(f"{sym}-USD")
        if price:
            return _store_cached_quote(cache_key, {"symbol": symbol, "price": price, "change_pct": change_pct})
        return _store_cached_quote(cache_key, {"symbol": symbol, "price": None, "change_pct": 0})

    # Stocks / ETFs: use yfinance
    price, change_pct = _get_stock_price(sym)
    if price:
        return _store_cached_quote(cache_key, {"symbol": symbol, "price": price, "change_pct": change_pct})

    return _store_cached_quote(cache_key, {"symbol": symbol, "price": None, "change_pct": 0})
