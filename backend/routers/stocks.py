import re
from collections import OrderedDict
from threading import Lock
from time import time

import requests
import yfinance as yf
from fastapi import APIRouter, Depends, HTTPException, Request

from models.auth import User
from utils.auth import get_current_user
from utils.limiter import limiter

router = APIRouter(prefix="/stocks", tags=["stocks"])

CRYPTO_SYMBOLS = {
    'BTC': 'bitcoin', 'ETH': 'ethereum', 'BNB': 'binancecoin', 'SOL': 'solana',
    'XRP': 'ripple', 'ADA': 'cardano', 'DOGE': 'dogecoin', 'AVAX': 'avalanche-2',
    'DOT': 'polkadot', 'MATIC': 'matic-network', 'LTC': 'litecoin',
    'SHIB': 'shiba-inu', 'TRX': 'tron', 'UNI': 'uniswap', 'LINK': 'chainlink',
    'TON': 'the-open-network', 'USDT': 'tether', 'USDC': 'usd-coin',
}

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


def _get_crypto_price(symbol: str) -> float | None:
    """CoinGecko free API — no key required."""
    sym = symbol.upper().replace('-USD', '')
    coin_id = CRYPTO_SYMBOLS.get(sym)
    if not coin_id:
        # Try searching by symbol
        try:
            r = requests.get(
                f"https://api.coingecko.com/api/v3/search?query={sym}",
                timeout=8
            )
            r.raise_for_status()
            coins = r.json().get('coins', [])
            if coins:
                coin_id = coins[0]['id']
            else:
                return None
        except Exception:
            return None
    try:
        r = requests.get(
            f"https://api.coingecko.com/api/v3/simple/price?ids={coin_id}&vs_currencies=usd",
            timeout=8
        )
        r.raise_for_status()
        data = r.json()
        price = data.get(coin_id, {}).get('usd')
        return round(float(price), 6) if price else None
    except Exception:
        return None


def _get_stock_price(symbol: str) -> tuple[float | None, float]:
    """yfinance — handles Yahoo Finance sessions/cookies properly."""
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.fast_info
        price = getattr(info, 'last_price', None) or getattr(info, 'regular_market_price', None)
        if price:
            prev_close = getattr(info, 'previous_close', None) or getattr(info, 'regular_market_previous_close', None)
            change_pct = ((price - prev_close) / prev_close * 100) if prev_close else 0.0
            return round(float(price), 4), round(float(change_pct), 2)
    except Exception:
        pass
    return None, 0.0


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
