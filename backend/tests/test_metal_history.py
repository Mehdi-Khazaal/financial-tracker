"""Gold's monthly price, for the chart beside the owner's gold.

Past months are fetched once and kept; the month in progress is refreshed
every few hours. The network is never reached in tests: the lookup is stubbed.
"""

from datetime import timedelta
from decimal import Decimal

import pytest

from models.database import MarketPrice, utc_now
from services import market_prices
from services.market_prices import fetch_monthly_closes as real_fetch_monthly_closes, history_key, metal_history
from utils.dates import user_today

MONTHS = ["2026-09", "2026-10", "2026-11"]


@pytest.fixture
def yahoo(monkeypatch):
    calls: list[tuple[str, int]] = []
    closes = {"2026-08": Decimal("3410"), "2026-09": Decimal("3655.5"), "2026-10": Decimal("4010"), "2026-11": Decimal("4048.8")}

    def fake(symbol, months):
        calls.append((symbol, months))
        return dict(closes)

    monkeypatch.setattr(market_prices, "fetch_monthly_closes", fake)
    return calls, closes


def test_each_months_close_comes_from_the_gold_future(db_session, yahoo):
    calls, _ = yahoo

    history = metal_history(db_session, "gold", MONTHS)

    assert history == [("2026-09", Decimal("3655.5")), ("2026-10", Decimal("4010")), ("2026-11", Decimal("4048.8"))]
    assert calls == [("GC=F", 3)]
    # Months outside the window are not stored.
    assert db_session.get(MarketPrice, history_key("metal:XAU", "2026-08")) is None


def test_past_months_are_kept_and_not_fetched_again(db_session, yahoo):
    calls, _ = yahoo
    metal_history(db_session, "gold", MONTHS)
    metal_history(db_session, "gold", MONTHS)

    assert len(calls) == 1


def test_the_month_in_progress_refreshes_when_it_is_old(db_session, yahoo):
    calls, closes = yahoo
    metal_history(db_session, "gold", MONTHS)
    row = db_session.get(MarketPrice, history_key("metal:XAU", "2026-11"))
    row.fetched_at = utc_now() - timedelta(hours=7)
    db_session.commit()
    closes["2026-11"] = Decimal("4100")

    history = metal_history(db_session, "gold", MONTHS)

    assert len(calls) == 2
    assert history[-1] == ("2026-11", Decimal("4100"))


def test_a_failed_lookup_leaves_out_the_months_it_could_not_price(db_session):
    # The suite's default lookup returns nothing, as Yahoo would when down.
    assert metal_history(db_session, "gold", MONTHS) == []
    assert metal_history(db_session, "platinum", MONTHS) == []


def test_the_route_lists_the_last_months_oldest_first(client, auth_headers, user, monkeypatch):
    today = user_today(user)
    this_month = today.strftime("%Y-%m")
    monkeypatch.setattr(market_prices, "fetch_monthly_closes", lambda symbol, months: {this_month: Decimal("4048.8")})

    body = client.get("/assets/metal-history?metal=gold&months=6", headers=auth_headers).json()

    assert body == [{"month": this_month, "price": "4048.800000"}]
    assert client.get("/assets/metal-history?metal=copper", headers=auth_headers).status_code == 422


def test_yahoo_monthly_rows_become_closes_by_month(monkeypatch):
    """The real parser over a frame shaped like yfinance's: NaN rows skipped, errors swallowed."""
    import pandas as pd

    # Daily rows: the month's last close wins, a NaN day is skipped.
    frame = pd.DataFrame(
        {"Close": [3600.0, 3655.5, float("nan"), 4010.0, float("nan"), 4048.8]},
        index=pd.to_datetime(["2026-09-02", "2026-09-30", "2026-10-30", "2026-10-29", "2026-11-09", "2026-11-10"]),
    )
    asked: list[tuple] = []

    class Ticker:
        def __init__(self, symbol):
            self.symbol = symbol

        def history(self, period, interval):
            asked.append((self.symbol, period, interval))
            if self.symbol == "DOWN":
                raise ConnectionError("Yahoo is down")
            return frame

    monkeypatch.setattr(market_prices.yf, "Ticker", Ticker)

    assert real_fetch_monthly_closes("GC=F", 3) == {
        "2026-09": Decimal("3655.5"), "2026-10": Decimal("4010.0"), "2026-11": Decimal("4048.8"),
    }
    assert asked == [("GC=F", "4mo", "1d")]
    assert real_fetch_monthly_closes("DOWN", 3) == {}
