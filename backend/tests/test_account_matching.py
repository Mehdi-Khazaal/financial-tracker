"""Which local account a Plaid account is allowed to attach to.

Matching on a name is deliberate: it lets a "Savings" someone typed in by hand
be adopted the first time their bank is connected, rather than appearing twice.
The rule that makes it safe is that the account must be **unclaimed** — no bank
already owns it.

The initial connect used to skip that check while the sync applied it, so
connecting a bank whose account shared a name with one another bank already
owned took it over: overwrote the balance and repointed `plaid_account_id`,
which is unique. Generic names make that collision ordinary, not exotic.

Every Plaid call is mocked.
"""

from decimal import Decimal

import pytest

from models.database import Account
from routers import plaid_router
from routers.plaid_router import PlaidItem, _match_local_account
from utils.secret_box import encrypt_secret


@pytest.fixture
def manual_savings(db_session, user):
    """Typed in by hand. No bank owns it."""
    row = Account(
        user_id=user.id, name="Savings", type="savings",
        balance=Decimal("2500"), currency="USD",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


@pytest.fixture
def claimed_savings(db_session, user):
    """Same name, but the first bank already owns it."""
    row = Account(
        user_id=user.id, name="Savings", type="savings",
        balance=Decimal("2500"), currency="USD",
        plaid_account_id="plaid-first-bank-savings",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


# --- The matcher --------------------------------------------------------------
def test_the_plaid_id_wins(db_session, user, claimed_savings):
    found = _match_local_account(db_session, user.id, "plaid-first-bank-savings", "Anything")
    assert found is not None and found.id == claimed_savings.id


def test_an_unclaimed_account_is_adopted_by_name(db_session, user, manual_savings):
    found = _match_local_account(db_session, user.id, "plaid-new-savings", "Savings")
    assert found is not None and found.id == manual_savings.id


def test_an_account_another_bank_owns_is_never_adopted(db_session, user, claimed_savings):
    """The defect. A second bank's "Savings" must not take over the first's."""
    found = _match_local_account(db_session, user.id, "plaid-second-bank-savings", "Savings")
    assert found is None, "matching by name must skip accounts a bank already owns"


def test_a_different_users_account_is_never_matched(db_session, user):
    from models.auth import User
    from utils import auth as auth_utils

    stranger = User(
        email="stranger-match@example.com", username="strangermatch",
        hashed_password=auth_utils.get_password_hash("Password123"),
        is_verified=True, is_admin=False,
    )
    db_session.add(stranger)
    db_session.commit()
    db_session.add(Account(
        user_id=stranger.id, name="Savings", type="savings",
        balance=Decimal("10"), currency="USD",
    ))
    db_session.commit()

    assert _match_local_account(db_session, user.id, "plaid-x", "Savings") is None


def test_no_match_is_no_match(db_session, user, manual_savings):
    assert _match_local_account(db_session, user.id, "plaid-x", "Chequing") is None


# --- Through the connect flow -------------------------------------------------
def _stub_connect(monkeypatch, accounts):
    def fake_post(path, body):
        if path == "/item/public_token/exchange":
            return {"access_token": "access-new", "item_id": "item-new"}
        if path == "/accounts/get":
            return {"accounts": accounts}
        if path == "/institutions/get_by_id":
            return {"institution": {"name": "Second Bank"}}
        if path == "/transactions/sync":
            return {"added": [], "modified": [], "removed": [],
                    "next_cursor": "c", "has_more": False}
        return {}

    monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)
    monkeypatch.setattr(plaid_router, "_do_sync_and_notify", lambda *a, **k: None)


SECOND_BANK_SAVINGS = {
    "account_id": "plaid-second-bank-savings",
    "name": "Savings",
    "subtype": "savings",
    "balances": {"current": 99},
}


def test_connecting_a_bank_does_not_hijack_another_banks_account(
    client, auth_headers, db_session, user, claimed_savings, monkeypatch
):
    _stub_connect(monkeypatch, [SECOND_BANK_SAVINGS])

    response = client.post(
        "/plaid/exchange-token",
        json={"public_token": "public-token-new", "institution_name": "Second Bank"},
        headers=auth_headers,
    )
    assert response.status_code == 200

    db_session.expire_all()
    # The first bank keeps its account, its balance and its link.
    original = db_session.query(Account).filter_by(id=claimed_savings.id).one()
    assert original.plaid_account_id == "plaid-first-bank-savings"
    assert original.balance == Decimal("2500")
    # And the second bank's account exists in its own right.
    created = db_session.query(Account).filter_by(
        plaid_account_id="plaid-second-bank-savings"
    ).one()
    assert created.id != claimed_savings.id
    assert created.balance == Decimal("99")


def test_connecting_a_bank_still_adopts_a_matching_manual_account(
    client, auth_headers, db_session, user, manual_savings, monkeypatch
):
    """The behaviour the name fallback exists for, kept intact."""
    _stub_connect(monkeypatch, [SECOND_BANK_SAVINGS])

    client.post(
        "/plaid/exchange-token",
        json={"public_token": "public-token-new", "institution_name": "Second Bank"},
        headers=auth_headers,
    )

    db_session.expire_all()
    adopted = db_session.query(Account).filter_by(id=manual_savings.id).one()
    assert adopted.plaid_account_id == "plaid-second-bank-savings"
    # One account, not two.
    assert db_session.query(Account).filter_by(user_id=user.id, name="Savings").count() == 1


def test_syncing_does_not_hijack_another_banks_account(
    db_session, user, claimed_savings, monkeypatch
):
    """The sync path had the guard already; this keeps it from being lost."""
    item = PlaidItem(
        user_id=user.id, access_token=encrypt_secret("t"),
        item_id="item-second", institution_name="Second Bank",
    )
    db_session.add(item)
    db_session.commit()

    def fake_post(path, body):
        if path == "/accounts/get":
            return {"accounts": [SECOND_BANK_SAVINGS]}
        if path == "/transactions/sync":
            return {"added": [], "modified": [], "removed": [],
                    "next_cursor": "c", "has_more": False}
        return {}

    monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)
    plaid_router._sync_item(db_session, item, user.id)

    db_session.expire_all()
    original = db_session.query(Account).filter_by(id=claimed_savings.id).one()
    assert original.plaid_account_id == "plaid-first-bank-savings"
    assert original.balance == Decimal("2500")
