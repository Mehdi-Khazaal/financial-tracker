import requests
import yfinance as yf
from fastapi import APIRouter

router = APIRouter(prefix="/stocks", tags=["stocks"])

CRYPTO_SYMBOLS = {
    'BTC': 'bitcoin', 'ETH': 'ethereum', 'BNB': 'binancecoin', 'SOL': 'solana',
    'XRP': 'ripple', 'ADA': 'cardano', 'DOGE': 'dogecoin', 'AVAX': 'avalanche-2',
    'DOT': 'polkadot', 'MATIC': 'matic-network', 'LTC': 'litecoin',
    'SHIB': 'shiba-inu', 'TRX': 'tron', 'UNI': 'uniswap', 'LINK': 'chainlink',
    'TON': 'the-open-network', 'USDT': 'tether', 'USDC': 'usd-coin',
}


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
def get_stock_price(symbol: str):
    sym = symbol.upper().strip().replace('-USD', '')

    # Crypto: use CoinGecko
    if sym in CRYPTO_SYMBOLS or symbol.upper().endswith('-USD'):
        price = _get_crypto_price(sym)
        if price:
            return {"symbol": symbol, "price": price, "change_pct": 0}
        # If CoinGecko fails, try yfinance with -USD suffix
        price, change_pct = _get_stock_price(f"{sym}-USD")
        if price:
            return {"symbol": symbol, "price": price, "change_pct": change_pct}
        return {"symbol": symbol, "price": None, "change_pct": 0}

    # Stocks / ETFs: use yfinance
    price, change_pct = _get_stock_price(sym)
    if price:
        return {"symbol": symbol, "price": price, "change_pct": change_pct}

    return {"symbol": symbol, "price": None, "change_pct": 0}
