"""Per-user preferences: what is stored, what takes effect, and who may change it.

Two values that look alike and are not:

* the **stored** preference — what the user asked for;
* the **effective** value — `stored AND AUTO_CATEGORIZE`, what actually happens.

Most of this file exists to keep them distinct. Folding them together would
mean an operator disabling the feature silently overwrote everyone's choice,
and switching it back on would restore the wrong thing.

The other half is the backward-compatibility contract: a user with no row has
defaults, and those defaults are exactly the behaviour that shipped before this
table existed.
"""

from datetime import date
from decimal import Decimal

import pytest

from models.auth import User
from models.database import Transaction, UserPreferences
from routers import plaid_router
from services import user_preferences
from utils import auth as auth_utils


@pytest.fixture
def stranger(db_session):
    row = User(
        email="stranger-prefs@example.com",
        username="strangerprefs",
        hashed_password=auth_utils.get_password_hash("Password123"),
        is_verified=True,
        is_admin=False,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


@pytest.fixture
def stranger_headers(stranger):
    return {"Authorization": f"Bearer {auth_utils.create_access_token({'sub': str(stranger.id)})}"}


@pytest.fixture
def admin_headers(db_session):
    row = User(
        email="admin-prefs@example.com",
        username="adminprefs",
        hashed_password=auth_utils.get_password_hash("Password123"),
        is_verified=True,
        is_admin=True,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return {"Authorization": f"Bearer {auth_utils.create_access_token({'sub': str(row.id)})}"}


# --- Authorization ------------------------------------------------------------
def test_reading_requires_authentication(client):
    assert client.get("/preferences").status_code == 401


def test_writing_requires_authentication(client):
    assert client.patch(
        "/preferences", json={"automatic_categorization_enabled": False}
    ).status_code == 401


# --- Defaults, and the absence of a row ---------------------------------------
def test_a_user_with_no_row_gets_the_defaults(client, auth_headers, db_session, user):
    """The backward-compatibility contract, stated as a test."""
    assert db_session.query(UserPreferences).filter_by(user_id=user.id).count() == 0

    body = client.get("/preferences", headers=auth_headers).json()

    assert body["automatic_categorization_enabled"] is True
    assert body["automatic_categorization_effective"] is True


def test_reading_does_not_create_a_row(client, auth_headers, db_session, user):
    """A read is a read. Rows appear when someone changes something."""
    client.get("/preferences", headers=auth_headers)
    client.get("/preferences", headers=auth_headers)

    assert db_session.query(UserPreferences).filter_by(user_id=user.id).count() == 0


def test_an_empty_patch_creates_nothing(client, auth_headers, db_session, user):
    response = client.patch("/preferences", json={}, headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["automatic_categorization_enabled"] is True
    assert db_session.query(UserPreferences).filter_by(user_id=user.id).count() == 0


# --- Writing ------------------------------------------------------------------
def test_turning_it_off_creates_exactly_one_row(client, auth_headers, db_session, user):
    response = client.patch(
        "/preferences", json={"automatic_categorization_enabled": False}, headers=auth_headers
    )

    assert response.status_code == 200
    assert response.json()["automatic_categorization_enabled"] is False

    rows = db_session.query(UserPreferences).filter_by(user_id=user.id).all()
    assert len(rows) == 1
    assert rows[0].automatic_categorization_enabled is False


def test_toggling_repeatedly_reuses_the_same_row(client, auth_headers, db_session, user):
    for value in (False, True, False):
        client.patch(
            "/preferences",
            json={"automatic_categorization_enabled": value},
            headers=auth_headers,
        )

    assert db_session.query(UserPreferences).filter_by(user_id=user.id).count() == 1
    assert client.get("/preferences", headers=auth_headers).json()[
        "automatic_categorization_enabled"
    ] is False


def test_the_setting_survives_a_new_request(client, auth_headers):
    client.patch(
        "/preferences", json={"automatic_categorization_enabled": False}, headers=auth_headers
    )
    assert client.get("/preferences", headers=auth_headers).json()[
        "automatic_categorization_enabled"
    ] is False


# --- Validation ---------------------------------------------------------------
def test_an_unknown_field_is_rejected_rather_than_ignored(client, auth_headers, db_session, user):
    """A silent 200 here would look exactly like a setting that saved."""
    response = client.patch(
        "/preferences",
        json={"automatic_categorisation_enabled": False},  # British spelling: a typo
        headers=auth_headers,
    )

    assert response.status_code == 422
    assert db_session.query(UserPreferences).filter_by(user_id=user.id).count() == 0


def test_a_non_boolean_is_rejected(client, auth_headers):
    response = client.patch(
        "/preferences", json={"automatic_categorization_enabled": "maybe"}, headers=auth_headers
    )
    assert response.status_code == 422


def test_the_effective_flag_is_not_writable(client, auth_headers):
    """It is derived. Accepting it would invite a client to think it means something."""
    response = client.patch(
        "/preferences", json={"automatic_categorization_effective": False}, headers=auth_headers
    )
    assert response.status_code == 422


# --- Tenant isolation ---------------------------------------------------------
def test_one_users_change_does_not_touch_another(
    client, auth_headers, stranger_headers, db_session, user, stranger
):
    client.patch(
        "/preferences", json={"automatic_categorization_enabled": False}, headers=auth_headers
    )

    theirs = client.get("/preferences", headers=stranger_headers).json()
    assert theirs["automatic_categorization_enabled"] is True

    assert db_session.query(UserPreferences).filter_by(user_id=user.id).count() == 1
    assert db_session.query(UserPreferences).filter_by(user_id=stranger.id).count() == 0


def test_an_admin_gets_their_own_preferences_not_everyones(
    client, admin_headers, auth_headers, db_session
):
    """There is no id in the path, so being an admin changes nothing here."""
    client.patch(
        "/preferences", json={"automatic_categorization_enabled": False}, headers=auth_headers
    )

    assert client.get("/preferences", headers=admin_headers).json()[
        "automatic_categorization_enabled"
    ] is True


def test_the_preference_row_is_declared_to_die_with_its_user():
    """No preference row may outlive its owner.

    Asserted against the schema rather than by deleting a user, because the
    guarantee is the database's and this suite runs on SQLite, which ignores
    foreign keys unless they are enabled per connection — and ignores the
    PRAGMA that enables them if it is issued inside a transaction, which a
    Session always is. A behavioural test here would delete the user, leave the
    row behind, and pass anyway.

    Postgres enforces this in production, and the Alembic revision declares the
    same `ondelete`; pinning the declaration is what keeps all three in step.
    """
    fk = next(iter(UserPreferences.__table__.c.user_id.foreign_keys))
    assert fk.column.table.name == "users"
    assert fk.ondelete == "CASCADE"
    assert UserPreferences.__table__.c.user_id.unique is True, "one row per user"


# --- The global kill-switch outranks the user ---------------------------------
def test_the_global_switch_disables_the_feature_without_changing_the_setting(
    client, auth_headers, monkeypatch
):
    """Off globally, on for the user: effective false, stored untouched."""
    monkeypatch.setenv("AUTO_CATEGORIZE", "false")

    body = client.get("/preferences", headers=auth_headers).json()

    assert body["automatic_categorization_enabled"] is True, "the user's choice is preserved"
    assert body["automatic_categorization_effective"] is False


def test_a_user_cannot_override_the_global_switch(client, auth_headers, monkeypatch):
    monkeypatch.setenv("AUTO_CATEGORIZE", "false")

    response = client.patch(
        "/preferences", json={"automatic_categorization_enabled": True}, headers=auth_headers
    )

    # The write is accepted — it records what they want — but it does not
    # take effect, and the response says so rather than implying success.
    assert response.status_code == 200
    assert response.json()["automatic_categorization_enabled"] is True
    assert response.json()["automatic_categorization_effective"] is False


def test_restoring_the_global_switch_restores_each_users_own_choice(
    client, auth_headers, stranger_headers, monkeypatch
):
    """Why stored and effective are separate columns of thought.

    If the kill-switch had written `false` into everyone's row, turning it back
    on would leave every user disabled, including the ones who never chose that.
    """
    client.patch(
        "/preferences", json={"automatic_categorization_enabled": False}, headers=auth_headers
    )

    monkeypatch.setenv("AUTO_CATEGORIZE", "false")
    assert client.get("/preferences", headers=stranger_headers).json()[
        "automatic_categorization_effective"
    ] is False

    monkeypatch.setenv("AUTO_CATEGORIZE", "true")
    # The one who opted out is still out; the one who never touched it is back.
    assert client.get("/preferences", headers=auth_headers).json()[
        "automatic_categorization_effective"
    ] is False
    assert client.get("/preferences", headers=stranger_headers).json()[
        "automatic_categorization_effective"
    ] is True


# --- No secrets ---------------------------------------------------------------
def test_the_response_carries_nothing_but_preferences(client, auth_headers):
    body = client.get("/preferences", headers=auth_headers).json()
    assert set(body) == {
        "automatic_categorization_enabled",
        "automatic_categorization_effective",
    }


# --- The service layer directly -----------------------------------------------
def test_the_per_session_memo_does_not_outlive_a_write(db_session, user):
    """The cache is an optimisation and must never hide a just-saved value."""
    assert user_preferences.automatic_categorization_enabled(db_session, user.id) is True

    user_preferences.upsert(db_session, user.id, {"automatic_categorization_enabled": False})
    db_session.commit()

    assert user_preferences.automatic_categorization_enabled(db_session, user.id) is False


def test_the_memo_keeps_users_apart(db_session, user, stranger):
    user_preferences.upsert(db_session, user.id, {"automatic_categorization_enabled": False})
    db_session.commit()

    assert user_preferences.automatic_categorization_enabled(db_session, user.id) is False
    assert user_preferences.automatic_categorization_enabled(db_session, stranger.id) is True

# --- Through the real import path ---------------------------------------------
# The tests above prove the rule; these prove it is actually wired to the thing
# users care about. A Plaid import with the preference off must still import,
# still resolve the merchant, still store Plaid's metadata — and simply leave
# the category empty.
#
# Plaid is stubbed. Nothing here touches the real API.

PLAID_ACCOUNT_ID = "plaid-acct-prefs"


@pytest.fixture
def plaid_import(monkeypatch, db_session, user, account):
    """One connected bank offering one recognisable transaction."""
    from routers.plaid_router import PlaidItem
    from utils.secret_box import encrypt_secret

    account.plaid_account_id = PLAID_ACCOUNT_ID
    item = PlaidItem(
        user_id=user.id,
        access_token=encrypt_secret("access-prefs"),
        item_id="item-prefs",
        institution_name="Test Bank",
    )
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)

    def fake_post(path, body):
        if path == "/accounts/get":
            return {"accounts": [{
                "account_id": PLAID_ACCOUNT_ID,
                "name": "Primary Checking",
                "subtype": "checking",
                "balances": {"current": 500},
            }]}
        if path == "/transactions/sync":
            return {
                "added": [{
                    "transaction_id": "tx-prefs-1",
                    "account_id": PLAID_ACCOUNT_ID,
                    "amount": "9.99",
                    "name": "NETFLIX*MEMBERSHIP",
                    "date": "2026-08-01",
                    "pending": False,
                    "merchant_entity_id": "ent_netflix",
                    "personal_finance_category": {
                        "primary": "ENTERTAINMENT", "detailed": "ENTERTAINMENT_STREAMING",
                    },
                }],
                "modified": [], "removed": [],
                "next_cursor": "cursor-1", "has_more": False,
            }
        return {}

    monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)
    return item


def _seed_netflix_history(db_session, user, account, category):
    """Enough prior filings for the merchant vote to be decisive."""
    for index, description in enumerate(["NETFLIX", "NETFLIX.COM"]):
        db_session.add(Transaction(
            user_id=user.id, account_id=account.id, category_id=category.id,
            amount=Decimal("-9.99"), description=description,
            merchant_key="netflix", transaction_date=date(2026, 7, index + 1),
        ))
    db_session.commit()


def test_an_import_is_categorized_while_the_preference_is_on(
    db_session, user, account, category, plaid_import
):
    """The baseline. Without this, the test below could pass for the wrong reason."""
    _seed_netflix_history(db_session, user, account, category)

    plaid_router._sync_item(db_session, plaid_import, user.id)

    imported = db_session.query(Transaction).filter_by(plaid_tx_id="tx-prefs-1").one()
    assert imported.category_id == category.id


def test_an_import_arrives_uncategorized_when_the_user_opted_out(
    db_session, user, account, category, plaid_import
):
    _seed_netflix_history(db_session, user, account, category)
    user_preferences.upsert(db_session, user.id, {"automatic_categorization_enabled": False})
    db_session.commit()

    plaid_router._sync_item(db_session, plaid_import, user.id)

    imported = db_session.query(Transaction).filter_by(plaid_tx_id="tx-prefs-1").one()
    # It imported — the switch is not an import switch.
    assert imported is not None
    assert imported.amount == Decimal("-9.99")
    # Enrichment ran in full.
    assert imported.merchant_key == "netflix"
    assert imported.plaid_merchant_entity_id == "ent_netflix"
    assert imported.personal_finance_category_primary == "ENTERTAINMENT"
    # Only the category is absent, ready to be filed by hand.
    assert imported.category_id is None
    assert imported.category_source is None


def test_the_user_can_still_categorize_by_hand_with_the_preference_off(
    client, auth_headers, db_session, user, account, category, plaid_import
):
    """Automatic off must never mean manual off."""
    user_preferences.upsert(db_session, user.id, {"automatic_categorization_enabled": False})
    db_session.commit()
    plaid_router._sync_item(db_session, plaid_import, user.id)
    imported = db_session.query(Transaction).filter_by(plaid_tx_id="tx-prefs-1").one()

    response = client.put(
        f"/transactions/{imported.id}",
        json={"category_id": category.id},
        headers=auth_headers,
    )

    assert response.status_code == 200
    db_session.expire_all()
    assert db_session.query(Transaction).filter_by(id=imported.id).one().category_id == category.id


def test_a_manual_entry_is_left_uncategorized_when_the_user_opted_out(
    client, auth_headers, db_session, user, account, category
):
    """The scope decision, pinned: this is not an imports-only switch."""
    _seed_netflix_history(db_session, user, account, category)
    user_preferences.upsert(db_session, user.id, {"automatic_categorization_enabled": False})
    db_session.commit()

    response = client.post(
        "/transactions/",
        json={
            "account_id": account.id,
            "amount": -9.99,
            "description": "NETFLIX*MEMBERSHIP",
            "transaction_date": "2026-08-02",
        },
        headers=auth_headers,
    )

    assert response.status_code == 201
    created = db_session.query(Transaction).filter_by(id=response.json()["id"]).one()
    assert created.category_id is None
    assert created.merchant_key == "netflix"
