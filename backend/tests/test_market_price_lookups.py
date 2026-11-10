"""The network lookups behind stored prices, with Yahoo and CoinGecko faked.

A failed lookup must come back as "no price", never as an exception and never
as a zero: the caller then keeps the last good price or the recorded value.
"""

from decimal import Decimal
from types import SimpleNamespace

import pytest

from services import market_prices
from services.market_prices import fetch_for_key as real_fetch_for_key


@pytest.fixture(autouse=True)
def real_lookup(monkeypatch):
    # The suite blocks the network by replacing `fetch_for_key`; these tests
    # are about it, so they restore it and fake the providers underneath.
    monkeypatch.setattr(market_prices, "fetch_for_key", real_fetch_for_key)


class FakeTicker:
    info = SimpleNamespace(last_price=369.30, previous_close=360.0)

    def __init__(self, symbol):
        self.symbol = symbol

    @property
    def fast_info(self):
        return self.info


def test_a_stock_price_and_its_day_change(monkeypatch):
    monkeypatch.setattr(market_prices.yf, "Ticker", FakeTicker)
    assert market_prices.fetch_stock_price("GLD") == (369.3, 2.58)


def test_a_stock_without_a_price_or_a_failing_provider_is_no_price(monkeypatch):
    class Empty(FakeTicker):
        info = SimpleNamespace(last_price=None, regular_market_price=None)

    monkeypatch.setattr(market_prices.yf, "Ticker", Empty)
    assert market_prices.fetch_stock_price("NOPE") == (None, 0.0)

    def broken(symbol):
        raise RuntimeError("yahoo is down")

    monkeypatch.setattr(market_prices.yf, "Ticker", broken)
    assert market_prices.fetch_stock_price("GLD") == (None, 0.0)


class FakeResponse:
    def __init__(self, payload, ok=True):
        self.payload = payload
        self.ok = ok

    def raise_for_status(self):
        if not self.ok:
            raise RuntimeError("http error")

    def json(self):
        return self.payload


def test_a_known_coin_is_priced_from_coingecko(monkeypatch):
    asked = []
    monkeypatch.setattr(market_prices.requests, "get",
                        lambda url, timeout: (asked.append(url), FakeResponse({"bitcoin": {"usd": 91000.5}}))[1])

    assert market_prices.fetch_crypto_price("btc") == 91000.5
    assert "ids=bitcoin" in asked[0]


def test_an_unknown_coin_is_searched_first(monkeypatch):
    responses = iter([
        FakeResponse({"coins": [{"id": "pepe"}]}),
        FakeResponse({"pepe": {"usd": 0.00001}}),
    ])
    monkeypatch.setattr(market_prices.requests, "get", lambda url, timeout: next(responses))
    assert market_prices.fetch_crypto_price("PEPE") == 0.00001


@pytest.mark.parametrize("responses", [
    [FakeResponse({"coins": []})],
    [FakeResponse({}, ok=False)],
    [FakeResponse({"coins": [{"id": "pepe"}]}), FakeResponse({}, ok=False)],
    [FakeResponse({"coins": [{"id": "pepe"}]}), FakeResponse({"pepe": {}})],
])
def test_a_coin_that_cannot_be_priced_is_no_price(monkeypatch, responses):
    queue = iter(responses)
    monkeypatch.setattr(market_prices.requests, "get", lambda url, timeout: next(queue))
    assert market_prices.fetch_crypto_price("ZZZ") is None


def test_crypto_falls_back_to_yahoo_when_coingecko_has_nothing(monkeypatch):
    monkeypatch.setattr(market_prices, "fetch_crypto_price", lambda symbol: None)
    monkeypatch.setattr(market_prices, "fetch_stock_price", lambda symbol: (90000.0, 1.25) if symbol == "BTC-USD" else (None, 0.0))

    assert real_fetch_for_key("crypto:BTC") == (Decimal("90000.0"), Decimal("1.25"))


def test_crypto_from_coingecko_has_no_day_change(monkeypatch):
    monkeypatch.setattr(market_prices, "fetch_crypto_price", lambda symbol: 91000.5)
    assert real_fetch_for_key("crypto:BTC") == (Decimal("91000.5"), None)


@pytest.mark.parametrize("key", ["stock:", "nonsense", "bond:US10Y"])
def test_keys_nothing_can_price(monkeypatch, key):
    monkeypatch.setattr(market_prices, "fetch_stock_price", lambda symbol: (1.0, 0.0))
    assert real_fetch_for_key(key) is None


def test_a_stock_key_with_no_price_is_no_price(monkeypatch):
    monkeypatch.setattr(market_prices, "fetch_stock_price", lambda symbol: (None, 0.0))
    assert real_fetch_for_key("stock:GLD") is None
    assert real_fetch_for_key("metal:XAU") is None
