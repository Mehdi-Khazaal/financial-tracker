"""Holdings are valued once, on the server, from stored market prices.

Portfolio used to fetch prices in the browser while the Dashboard and the
assistant used recorded values, so one holding had different values on
different screens. These tests pin the shared rules and the stored-price
behaviour that replaced that.
"""

from datetime import timedelta
from decimal import Decimal

import pytest

from models.auth import User
from models.database import Asset, MarketPrice, utc_now
from services import market_prices
from services.market_prices import FRESH_FOR, get_quotes, refresh_quotes, stored_quotes
from services.valuation import price_key, ticker_of, value_assets, value_holdings
from utils import auth as auth_utils


@pytest.fixture
def lookups(monkeypatch):
    """Replace the network with a table of prices, and record every lookup."""
    table: dict[str, Decimal | None] = {}
    calls: list[str] = []

    def fake_fetch(key):
        calls.append(key)
        price = table.get(key)
        return (price, Decimal("1.5")) if price is not None else None

    monkeypatch.setattr(market_prices, "fetch_for_key", fake_fetch)
    return table, calls


def _asset(db, user, **overrides):
    values = dict(
        user_id=user.id, name="GOLD (GLD)", type="stock", asset_class="investment",
        quantity=Decimal("3.0965"), value_per_unit=Decimal("419.84"), total_value=Decimal("1300.01"),
    )
    values.update(overrides)
    row = Asset(**values)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _store(db, key, price, age=timedelta(0)):
    db.add(MarketPrice(key=key, price=Decimal(str(price)), fetched_at=utc_now() - age))
    db.commit()


# ─── Ticker and key rules ─────────────────────────────────────────────────────
@pytest.mark.parametrize("name, expected", [
    ("GOLD (GLD)", "GLD"),
    ("Vanguard ETF (VTI)", "VTI"),
    ("VTI", "VTI"),
    ("  AAPL ", "AAPL"),
    ("Gold Ounce", None),
    ("apple", None),
    ("", None),
    (None, None),
])
def test_ticker_of_matches_the_frontend_rule(name, expected):
    assert ticker_of(name) == expected


def test_price_key_depends_on_the_holding_type(db_session, user):
    assert price_key(_asset(db_session, user)) == "stock:GLD"
    assert price_key(_asset(db_session, user, name="Bitcoin (BTC)", type="crypto")) == "crypto:BTC"
    assert price_key(_asset(db_session, user, name="VTI", type="etf")) == "stock:VTI"
    # A physical holding is never looked up, even if its name looks like a ticker.
    assert price_key(_asset(db_session, user, name="GLD", type="jewelry", asset_class="physical")) is None


# ─── Valuation rules ──────────────────────────────────────────────────────────
def test_a_priced_holding_is_worth_price_times_quantity(db_session, user, lookups):
    asset = _asset(db_session, user)
    _store(db_session, "stock:GLD", "369.30")

    valuation = value_assets([asset], stored_quotes(db_session, ["stock:GLD"]))
    holding = valuation.holdings[0]

    assert holding.source == "market"
    assert holding.current_value == Decimal("1143.54")
    assert holding.change_since_recorded == Decimal("-156.47")
    assert valuation.total == Decimal("1143.54")
    assert valuation.recorded_total == Decimal("1300.01")


def test_an_unpriced_holding_keeps_its_recorded_value(db_session, user):
    asset = _asset(db_session, user, name="Gold Ounce", type="jewelry", asset_class="physical",
                   quantity=Decimal("2"), total_value=Decimal("8000"))

    holding = value_assets([asset], {}).holdings[0]

    assert holding.source == "recorded"
    assert holding.current_value == Decimal("8000")
    # Unknown, not zero: nothing was checked against a market.
    assert holding.change_since_recorded is None


def test_a_holding_without_a_quantity_counts_as_one_unit(db_session, user):
    asset = _asset(db_session, user, quantity=None)
    _store(db_session, "stock:GLD", "100")

    holding = value_assets([asset], stored_quotes(db_session, ["stock:GLD"])).holdings[0]

    assert holding.current_value == Decimal("100.00")


# ─── Stored prices ────────────────────────────────────────────────────────────
def test_missing_mode_fetches_only_what_was_never_stored(db_session, lookups):
    table, calls = lookups
    table["stock:GLD"] = Decimal("370")
    table["stock:VTI"] = Decimal("250")
    _store(db_session, "stock:GLD", "360", age=FRESH_FOR * 4)

    quotes = get_quotes(db_session, ["stock:GLD", "stock:VTI"], refresh="missing")

    assert calls == ["stock:VTI"]
    assert quotes["stock:GLD"].price == Decimal("360")
    assert quotes["stock:VTI"].price == Decimal("250")


def test_stale_mode_refreshes_old_prices(db_session, lookups):
    table, calls = lookups
    table["stock:GLD"] = Decimal("370")
    _store(db_session, "stock:GLD", "360", age=FRESH_FOR * 4)

    quotes = get_quotes(db_session, ["stock:GLD"], refresh="stale")

    assert calls == ["stock:GLD"]
    assert quotes["stock:GLD"].price == Decimal("370")


def test_stale_mode_leaves_fresh_prices_alone(db_session, lookups):
    _, calls = lookups
    _store(db_session, "stock:GLD", "360")

    get_quotes(db_session, ["stock:GLD"], refresh="stale")

    assert calls == []


def test_never_mode_does_not_touch_the_network(db_session, lookups):
    _, calls = lookups

    assert get_quotes(db_session, ["stock:GLD"], refresh="never") == {}
    assert calls == []


def test_a_failed_lookup_keeps_the_last_good_price(db_session, lookups):
    table, _ = lookups
    table["stock:GLD"] = None
    _store(db_session, "stock:GLD", "360", age=FRESH_FOR * 4)

    quotes = refresh_quotes(db_session, ["stock:GLD"])

    assert quotes["stock:GLD"].price == Decimal("360")


def test_value_holdings_reads_only_the_users_own_assets(db_session, user, lookups):
    table, _ = lookups
    table["stock:GLD"] = Decimal("369.30")
    stranger = User(
        email="stranger-valuation@example.com", username="strangerval",
        hashed_password=auth_utils.get_password_hash("Password123"),
        is_verified=True, is_admin=False,
    )
    db_session.add(stranger)
    db_session.commit()
    _asset(db_session, user)
    _asset(db_session, stranger, name="Their Gold", type="jewelry", total_value=Decimal("99999"))

    valuation = value_holdings(db_session, user.id)

    assert [h.current_value for h in valuation.holdings] == [Decimal("1143.54")]


# ─── Endpoint ─────────────────────────────────────────────────────────────────
def test_valuations_endpoint_prices_a_holding_on_first_read(client, db_session, user, auth_headers, lookups):
    table, calls = lookups
    table["stock:GLD"] = Decimal("369.30")
    asset = _asset(db_session, user)

    response = client.get("/assets/valuations", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert calls == ["stock:GLD"]
    assert body["refreshing"] is False
    assert Decimal(body["total"]) == Decimal("1143.54")
    assert body["holdings"][0]["asset_id"] == asset.id
    assert body["holdings"][0]["source"] == "market"


def test_valuations_endpoint_serves_old_prices_and_refreshes_behind_them(
    client, db_session, user, auth_headers, lookups,
):
    table, calls = lookups
    table["stock:GLD"] = Decimal("380")
    _asset(db_session, user)
    _store(db_session, "stock:GLD", "360", age=FRESH_FOR * 4)

    first = client.get("/assets/valuations", headers=auth_headers).json()

    # Answered from the stored price without waiting...
    assert first["refreshing"] is True
    assert Decimal(first["holdings"][0]["price_per_unit"]) == Decimal("360")
    # ...and the background task stored the new one for the next read.
    assert calls == ["stock:GLD"]
    second = client.get("/assets/valuations", headers=auth_headers).json()
    assert Decimal(second["holdings"][0]["price_per_unit"]) == Decimal("380")
    assert second["refreshing"] is False


def test_valuations_endpoint_refresh_fetches_everything_now(client, db_session, user, auth_headers, lookups):
    table, calls = lookups
    table["stock:GLD"] = Decimal("380")
    _asset(db_session, user)
    _store(db_session, "stock:GLD", "360")

    body = client.get("/assets/valuations?refresh=true", headers=auth_headers).json()

    assert calls == ["stock:GLD"]
    assert Decimal(body["holdings"][0]["price_per_unit"]) == Decimal("380")


def test_valuations_endpoint_requires_sign_in(client):
    assert client.get("/assets/valuations").status_code == 401
