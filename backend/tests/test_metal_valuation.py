"""Gold is worth its fine weight at today's price.

The live account held $19,429.99 of gold (ounces, a gold lira, jewelry), two
thirds of everything it owned, every piece frozen at its purchase price. A
holding with a metal, a weight and a purity is now valued from the gold price.
"""

from decimal import Decimal

import pytest

from models.database import Asset, MarketPrice, utc_now
from services import market_prices
from services.valuation import TROY_OUNCE_GRAMS, fine_ounces_per_unit, price_key, value_assets
from services.market_prices import fetch_for_key as real_fetch_for_key, stored_quotes

GOLD = "metal:XAU"


@pytest.fixture
def lookups(monkeypatch):
    table: dict[str, Decimal] = {}
    calls: list[str] = []

    def fake(key):
        calls.append(key)
        return (table[key], Decimal("0.4")) if key in table else None

    monkeypatch.setattr(market_prices, "fetch_for_key", fake)
    return table, calls


def _asset(db, user, **overrides):
    values = dict(user_id=user.id, name="Gold Ounce", type="jewelry", asset_class="physical",
                  quantity=Decimal("2"), value_per_unit=Decimal("4000"), total_value=Decimal("8000"))
    values.update(overrides)
    row = Asset(**values)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _gold_at(db, price):
    db.add(MarketPrice(key=GOLD, price=Decimal(str(price)), fetched_at=utc_now()))
    db.commit()


def test_an_ounce_coin_is_worth_its_fine_gold(db_session, user):
    coins = _asset(db_session, user, metal="gold", weight_grams=TROY_OUNCE_GRAMS, purity=Decimal("0.9999"))
    _gold_at(db_session, "4000")

    holding = value_assets([coins], stored_quotes(db_session, [GOLD])).holdings[0]

    assert holding.source == "metal"
    assert holding.spot_price == Decimal("4000")
    # Two coins, 0.9999 fine: 2 × 0.9999 × 4,000.
    assert holding.current_value == Decimal("7999.20")
    assert holding.price_per_unit == Decimal("3999.60")
    assert holding.change_since_recorded == Decimal("-0.80")


def test_a_22_karat_gold_lira_is_priced_by_its_gold_content(db_session, user):
    lira = _asset(db_session, user, name="Gold Lira", quantity=Decimal("1"), total_value=Decimal("1050"),
                  metal="gold", weight_grams=Decimal("7.988"), purity=Decimal("0.9167"))
    _gold_at(db_session, "4000")

    holding = value_assets([lira], stored_quotes(db_session, [GOLD])).holdings[0]

    # 7.988 g × 0.9167 = 7.3226 g of gold = 0.23543 oz.
    assert holding.current_value == Decimal("941.71")


def test_jewelry_reads_below_its_price_because_the_making_charge_is_not_gold(db_session, user):
    ring = _asset(db_session, user, name="Gold", quantity=Decimal("1"), total_value=Decimal("1200"),
                  metal="gold", weight_grams=Decimal("8"), purity=Decimal("0.75"))
    _gold_at(db_session, "4000")

    holding = value_assets([ring], stored_quotes(db_session, [GOLD])).holdings[0]

    assert holding.current_value == Decimal("771.62")
    assert holding.change_since_recorded == Decimal("-428.38")


def test_without_a_weight_a_piece_keeps_its_recorded_value(db_session, user):
    piece = _asset(db_session, user)
    _gold_at(db_session, "4000")

    assert price_key(piece) is None
    assert fine_ounces_per_unit(piece) is None
    assert value_assets([piece], stored_quotes(db_session, [GOLD])).holdings[0].current_value == Decimal("8000")


def test_metal_pricing_wins_over_a_ticker(db_session, user):
    bar = _asset(db_session, user, name="GLD", type="stock", asset_class="investment",
                 metal="gold", weight_grams=Decimal("10"), purity=Decimal("0.9999"))
    assert price_key(bar) == GOLD


def test_silver_uses_its_own_price(db_session, user):
    eagle = _asset(db_session, user, name="Silver Eagle", metal="silver",
                   weight_grams=TROY_OUNCE_GRAMS, purity=Decimal("0.999"))
    assert price_key(eagle) == "metal:XAG"


def test_the_gold_price_comes_from_the_comex_future(monkeypatch):
    # The suite blocks the network by replacing `fetch_for_key`; this test is
    # about that function, so it puts the real one back and fakes Yahoo instead.
    monkeypatch.setattr(market_prices, "fetch_for_key", real_fetch_for_key)
    asked: list[str] = []
    monkeypatch.setattr(market_prices, "fetch_stock_price", lambda symbol: (asked.append(symbol), (4012.3, 0.5))[1])
    assert market_prices.fetch_for_key(GOLD) == (Decimal("4012.3"), Decimal("0.5"))
    assert market_prices.fetch_for_key("metal:XAG") == (Decimal("4012.3"), Decimal("0.5"))
    assert market_prices.fetch_for_key("metal:NOPE") is None
    assert asked == ["GC=F", "SI=F"]


# ─── API ──────────────────────────────────────────────────────────────────────
def test_valuations_report_metal_holdings_with_the_gold_price(client, db_session, user, auth_headers, lookups):
    table, _ = lookups
    table[GOLD] = Decimal("4000")
    _asset(db_session, user, metal="gold", weight_grams=TROY_OUNCE_GRAMS, purity=Decimal("1"))

    body = client.get("/assets/valuations", headers=auth_headers).json()

    assert body["holdings"][0]["source"] == "metal"
    assert Decimal(body["holdings"][0]["spot_price"]) == Decimal("4000")
    assert Decimal(body["total"]) == Decimal("8000.00")


def test_metal_prices_endpoint_returns_gold_per_ounce(client, auth_headers, lookups):
    table, _ = lookups
    table[GOLD] = Decimal("4012.30")

    body = client.get("/assets/metal-prices", headers=auth_headers).json()

    assert [(p["metal"], Decimal(p["price"])) for p in body] == [("gold", Decimal("4012.30"))]


def test_metal_fields_must_come_together(client, auth_headers):
    base = {"name": "Gold", "type": "jewelry", "asset_class": "physical", "total_value": 1000}

    partial = client.post("/assets/", json={**base, "metal": "gold", "weight_grams": 8}, headers=auth_headers)
    assert partial.status_code == 422

    whole = client.post("/assets/", json={**base, "metal": "gold", "weight_grams": 8, "purity": 0.875}, headers=auth_headers)
    assert whole.status_code == 201, whole.text
    asset_id = whole.json()["id"]

    broken = client.put(f"/assets/{asset_id}", json={"purity": None}, headers=auth_headers)
    assert broken.status_code == 422

    cleared = client.put(f"/assets/{asset_id}", json={"metal": None, "weight_grams": None, "purity": None}, headers=auth_headers)
    assert cleared.status_code == 200
    assert cleared.json()["metal"] is None


@pytest.mark.parametrize("field, value", [("purity", 1.5), ("purity", 0), ("weight_grams", -1), ("metal", "platinum")])
def test_impossible_metal_values_are_refused(client, auth_headers, field, value):
    payload = {"name": "Gold", "type": "jewelry", "total_value": 1000,
               "metal": "gold", "weight_grams": 8, "purity": 0.75, field: value}
    assert client.post("/assets/", json=payload, headers=auth_headers).status_code == 422


def test_net_worth_now_counts_gold_at_todays_price(client, db_session, user, auth_headers, lookups):
    table, _ = lookups
    table[GOLD] = Decimal("4000")
    _asset(db_session, user, metal="gold", weight_grams=TROY_OUNCE_GRAMS, purity=Decimal("1"),
           total_value=Decimal("8200"))
    _gold_at(db_session, "4000")

    points = client.get("/history/net-worth?months=1", headers=auth_headers).json()

    assert points[-1]["holdings"] == "8000.00"
