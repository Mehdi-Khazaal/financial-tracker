import requests
from fastapi import APIRouter

router = APIRouter(prefix="/stocks", tags=["stocks"])

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
}

# Known crypto symbols that need -USD suffix on Yahoo Finance
CRYPTO_SYMBOLS = {'BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','DOT','MATIC','LTC','SHIB','TRX','UNI','LINK'}


@router.get("/{symbol}")
def get_stock_price(symbol: str):
    sym_upper = symbol.upper()

    # Build list of symbols to try
    candidates = [sym_upper]
    if sym_upper in CRYPTO_SYMBOLS or sym_upper.endswith('-USD'):
        base = sym_upper.replace('-USD', '')
        candidates = [f"{base}-USD", base]
    else:
        candidates = [sym_upper, f"{sym_upper}-USD"]

    for sym in candidates:
        try:
            url = f"https://query1.finance.yahoo.com/v7/finance/quote?symbols={sym}&fields=regularMarketPrice,regularMarketChangePercent"
            r = requests.get(url, headers=HEADERS, timeout=6)
            data = r.json()
            result = data.get('quoteResponse', {}).get('result', [])
            if result:
                price = result[0].get('regularMarketPrice')
                change_pct = result[0].get('regularMarketChangePercent', 0)
                if price:
                    return {"symbol": symbol, "price": round(price, 4), "change_pct": round(change_pct, 2)}
        except Exception:
            continue

    return {"symbol": symbol, "price": None, "change_pct": 0}
