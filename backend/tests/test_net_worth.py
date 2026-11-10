"""One net worth: account balances plus holdings, on every screen and in history.

Two defects shaped these tests:

* The chart's last point came from a stored snapshot dated the end of the
  month, written at the last refresh. Anything that posted afterwards made it
  disagree with the balance on screen (live: $9,572.59 against $9,218.40).
* Holdings were left out of net worth, so buying gold with cash read as a
  loss of the full price. They now count from the day they were acquired.
"""

from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest

from models.database import Account, AccountBalanceSnapshot, Asset, MarketPrice, Transaction, utc_now
from services.net_worth import accounts_total, acquired_on, holdings_recorded_by
from utils.dates import user_today


def _months_ago_end(today: date, months: int) -> date:
    year, month = today.year, today.month - months
    while month <= 0:
        month += 12
        year -= 1
    nxt = date(year + (month == 12), (month % 12) + 1, 1)
    return nxt - timedelta(days=1)


@pytest.fixture
def today(user):
    return user_today(user)


def _history(client, auth_headers, months=3):
    response = client.get(f"/history/net-worth?months={months}", headers=auth_headers)
    assert response.status_code == 200
    return response.json()


def test_the_current_month_uses_todays_balances_not_a_stored_snapshot(
    client, db_session, user, auth_headers, account, today,
):
    # A snapshot for this month's end, written before the latest change.
    month_end = _months_ago_end(today, 0)
    db_session.add(AccountBalanceSnapshot(
        user_id=user.id, account_id=account.id, snapshot_date=month_end,
        closing_balance=Decimal("1354.19"),
    ))
    db_session.commit()

    points = _history(client, auth_headers, months=1)

    assert points[-1]["accounts"] == "1000.00"
    assert points[-1]["net_worth"] == "1000.00"


def test_past_months_still_read_their_snapshots(client, db_session, user, auth_headers, account, today):
    last_month_end = _months_ago_end(today, 1)
    db_session.add(AccountBalanceSnapshot(
        user_id=user.id, account_id=account.id, snapshot_date=last_month_end,
        closing_balance=Decimal("750.00"),
    ))
    db_session.commit()

    points = _history(client, auth_headers, months=2)

    assert [p["accounts"] for p in points] == ["750.00", "1000.00"]


def test_a_holding_counts_from_the_day_it_was_bought(client, db_session, user, auth_headers, account, today):
    """Buying an $800 coin with cash moves money between parts; the total holds."""
    bought = _months_ago_end(today, 1) - timedelta(days=3)
    db_session.add(Transaction(
        user_id=user.id, account_id=account.id, amount=Decimal("-800.00"),
        description="Coin dealer", transaction_date=bought,
    ))
    db_session.add(Asset(
        user_id=user.id, name="Gold coin", type="jewelry", asset_class="physical",
        quantity=Decimal("1"), value_per_unit=Decimal("800"), total_value=Decimal("800"),
        purchase_date=bought,
    ))
    account.balance = Decimal("200.00")
    db_session.commit()

    points = _history(client, auth_headers, months=3)

    # Two months ago: the cash, no coin. Last month and now: less cash, the coin.
    assert [p["accounts"] for p in points] == ["1000.00", "200.00", "200.00"]
    assert [p["holdings"] for p in points] == ["0.00", "800.00", "800.00"]
    assert [p["net_worth"] for p in points] == ["1000.00", "1000.00", "1000.00"]


def test_the_current_month_values_holdings_at_the_stored_price(
    client, db_session, user, auth_headers, account,
):
    db_session.add(Asset(
        user_id=user.id, name="GOLD (GLD)", type="stock", asset_class="investment",
        quantity=Decimal("2"), value_per_unit=Decimal("400"), total_value=Decimal("800"),
        purchase_date=date(2025, 1, 2),
    ))
    db_session.add(MarketPrice(key="stock:GLD", price=Decimal("369.30"), fetched_at=utc_now()))
    db_session.commit()

    points = _history(client, auth_headers, months=2)

    # Past month at the recorded value, this month at today's price.
    assert [p["holdings"] for p in points] == ["800.00", "738.60"]
    assert points[-1]["net_worth"] == "1738.60"


def test_investment_type_accounts_stay_out(client, db_session, user, auth_headers, account):
    db_session.add(Account(user_id=user.id, name="Brokerage", type="investment",
                           balance=Decimal("5000"), currency="USD"))
    db_session.commit()

    assert _history(client, auth_headers, months=1)[-1]["net_worth"] == "1000.00"


def test_someone_with_only_holdings_still_gets_a_history(client, db_session, user, auth_headers):
    db_session.add(Asset(
        user_id=user.id, name="Gold", type="jewelry", asset_class="physical",
        total_value=Decimal("1200"), purchase_date=date(2025, 1, 1),
    ))
    db_session.commit()

    points = _history(client, auth_headers, months=2)

    assert [p["net_worth"] for p in points] == ["1200.00", "1200.00"]


def test_nothing_held_means_no_history(client, auth_headers):
    assert _history(client, auth_headers, months=3) == []


# ─── Pure helpers ─────────────────────────────────────────────────────────────
def test_acquired_on_falls_back_to_when_the_holding_was_added():
    asset = Asset(name="x", type="jewelry", total_value=Decimal("1"),
                  created_at=datetime(2026, 2, 3, 15, 0))
    assert acquired_on(asset) == date(2026, 2, 3)
    asset.purchase_date = date(2025, 7, 1)
    assert acquired_on(asset) == date(2025, 7, 1)


def test_holdings_recorded_by_counts_only_what_was_held_that_day():
    assets = [
        Asset(name="a", type="jewelry", total_value=Decimal("100"), purchase_date=date(2026, 1, 10)),
        Asset(name="b", type="jewelry", total_value=Decimal("50"), purchase_date=date(2026, 3, 1)),
    ]
    assert holdings_recorded_by(assets, date(2026, 1, 9)) == Decimal("0")
    assert holdings_recorded_by(assets, date(2026, 1, 10)) == Decimal("100")
    assert holdings_recorded_by(assets, date(2026, 3, 31)) == Decimal("150")


def test_accounts_total_subtracts_cards_and_skips_investment_accounts():
    accounts = [
        Account(name="c", type="checking", balance=Decimal("693.28")),
        Account(name="h", type="cash", balance=Decimal("4910")),
        Account(name="v", type="credit_card", balance=Decimal("-384.92")),
        Account(name="b", type="investment", balance=Decimal("9999")),
    ]
    assert accounts_total(accounts) == Decimal("5218.36")
