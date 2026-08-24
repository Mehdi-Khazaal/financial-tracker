"""Which way round a balance points.

Plaid and Fintrack describe a credit card from opposite sides. Plaid states it
as a liability — *"For `credit`-type accounts, a positive balance indicates the
amount owed; a negative amount indicates the lender owing the account holder"* —
and Fintrack stores every account from the holder's side, where money you owe
is negative and money owed to you is positive.

The conversion used to be `-abs(current)`, which is correct for the ordinary
case and silently wrong for an overpaid card: Plaid reports the overpayment as
a negative current balance, and `-abs` mapped it straight back to negative, so
a card the issuer owed money on was indistinguishable from a debt of the same
size. It read as "owed" in the UI and pulled net worth down instead of up.

Every Plaid call is mocked. Nothing here touches the real API.
"""

from decimal import Decimal

import pytest

from models.database import Account
from routers import plaid_router
from routers.plaid_router import PlaidItem, _local_balance
from utils.secret_box import encrypt_secret


CARD_PLAID_ID = "plaid-acct-card"


# --- The conversion on its own ------------------------------------------------
@pytest.mark.parametrize(
    "plaid_current, expected",
    [
        (500, Decimal("-500")),      # owes 500 → a liability
        (0.01, Decimal("-0.01")),
        (0, Decimal("0")),           # paid off
        (-50, Decimal("50")),        # overpaid → the issuer owes 50
        (-0.01, Decimal("0.01")),
    ],
)
def test_a_card_balance_keeps_its_direction(plaid_current, expected):
    assert _local_balance({"current": plaid_current}, True) == expected


@pytest.mark.parametrize("plaid_current", [900, 0, -25])
def test_a_depository_balance_passes_through(plaid_current):
    """Checking and savings are already stated from the holder's side."""
    assert _local_balance({"current": plaid_current}, False) == Decimal(str(plaid_current))


def test_a_missing_balance_is_zero_not_an_error():
    assert _local_balance({}, True) == Decimal("0")
    assert _local_balance({"current": None}, False) == Decimal("0")


def test_the_old_collapse_is_gone():
    """The specific defect, named so a future `abs()` cannot creep back in."""
    owed = _local_balance({"current": 50}, True)
    in_credit = _local_balance({"current": -50}, True)
    assert owed != in_credit, "an overpaid card must not look like a debt"
    assert owed < 0 < in_credit


# --- Through the real sync path -----------------------------------------------
@pytest.fixture
def card_account(db_session, user):
    row = Account(
        user_id=user.id,
        name="Test Card",
        type="credit_card",
        balance=Decimal("-500"),
        currency="USD",
        plaid_account_id=CARD_PLAID_ID,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


@pytest.fixture
def item(db_session, user):
    row = PlaidItem(
        user_id=user.id,
        access_token=encrypt_secret("access-balances"),
        item_id="item-balances",
        institution_name="Test Bank",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def _stub_plaid(monkeypatch, current):
    def fake_post(path, body):
        if path == "/accounts/get":
            return {"accounts": [{
                "account_id": CARD_PLAID_ID,
                "name": "Test Card",
                "subtype": "credit card",
                "balances": {"current": current},
            }]}
        if path == "/transactions/sync":
            return {"added": [], "modified": [], "removed": [],
                    "next_cursor": "c", "has_more": False}
        return {}

    monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)


def test_syncing_an_owed_card_stores_a_debt(
    db_session, user, item, card_account, monkeypatch
):
    _stub_plaid(monkeypatch, 742.19)

    plaid_router._sync_item(db_session, item, user.id)

    db_session.expire_all()
    assert db_session.query(Account).filter_by(id=card_account.id).one().balance == Decimal("-742.19")


def test_syncing_an_overpaid_card_stores_a_credit(
    db_session, user, item, card_account, monkeypatch
):
    """The reported bug: this used to store −50 and read as "$50.00 owed"."""
    _stub_plaid(monkeypatch, -50)

    plaid_router._sync_item(db_session, item, user.id)

    db_session.expire_all()
    stored = db_session.query(Account).filter_by(id=card_account.id).one().balance
    assert stored == Decimal("50"), "an overpaid card is money owed *to* the holder"


def test_a_card_that_swings_between_the_two_follows(
    db_session, user, item, card_account, monkeypatch
):
    """Overpay, then spend past it again. Each sync reports the current truth."""
    _stub_plaid(monkeypatch, -120)
    plaid_router._sync_item(db_session, item, user.id)
    db_session.expire_all()
    assert db_session.query(Account).filter_by(id=card_account.id).one().balance == Decimal("120")

    _stub_plaid(monkeypatch, 30)
    plaid_router._sync_item(db_session, item, user.id)
    db_session.expire_all()
    assert db_session.query(Account).filter_by(id=card_account.id).one().balance == Decimal("-30")


def test_a_paid_off_card_is_zero_either_way(
    db_session, user, item, card_account, monkeypatch
):
    _stub_plaid(monkeypatch, 0)

    plaid_router._sync_item(db_session, item, user.id)

    db_session.expire_all()
    assert db_session.query(Account).filter_by(id=card_account.id).one().balance == Decimal("0")


def test_a_checking_account_is_untouched_by_the_credit_rule(
    db_session, user, item, account, monkeypatch
):
    account.plaid_account_id = "plaid-acct-checking"
    db_session.commit()

    def fake_post(path, body):
        if path == "/accounts/get":
            return {"accounts": [{
                "account_id": "plaid-acct-checking",
                "name": "Primary Checking",
                "subtype": "checking",
                "balances": {"current": 1234.56},
            }]}
        if path == "/transactions/sync":
            return {"added": [], "modified": [], "removed": [],
                    "next_cursor": "c", "has_more": False}
        return {}

    monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)
    plaid_router._sync_item(db_session, item, user.id)

    db_session.expire_all()
    assert db_session.query(Account).filter_by(id=account.id).one().balance == Decimal("1234.56")


def test_an_overdrawn_checking_account_stays_negative(
    db_session, user, item, account, monkeypatch
):
    """A negative depository balance is an overdraft, not a credit."""
    account.plaid_account_id = "plaid-acct-checking"
    db_session.commit()

    def fake_post(path, body):
        if path == "/accounts/get":
            return {"accounts": [{
                "account_id": "plaid-acct-checking",
                "name": "Primary Checking",
                "subtype": "checking",
                "balances": {"current": -80},
            }]}
        if path == "/transactions/sync":
            return {"added": [], "modified": [], "removed": [],
                    "next_cursor": "c", "has_more": False}
        return {}

    monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)
    plaid_router._sync_item(db_session, item, user.id)

    db_session.expire_all()
    assert db_session.query(Account).filter_by(id=account.id).one().balance == Decimal("-80")
