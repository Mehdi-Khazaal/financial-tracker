"""Link update mode: repairing an existing Item instead of creating a new one.

Update mode is the only correct response to `ITEM_LOGIN_REQUIRED`. Without it
the user is stuck: the ordinary Connect flow mints a second Item for the same
institution, `exchange_token` rejects that with "already connected", and the
only remaining routes are Disconnect (loses the connection) or Reset
(destroys every imported transaction).

Plaid's documented contract for update mode, which these tests pin:

  * `access_token` identifies the Item to repair;
  * **`products` is omitted** — passing it in update mode is an error unless
    adding a product, which repair is not;
  * `user.client_user_id`, `country_codes` and `language` remain required;
  * `webhook` may be included;
  * the Item is *reused*: its `access_token` does not change, so there is no
    exchange-token step afterwards.

Every Plaid call is mocked. Nothing here touches a real Plaid endpoint, and
nothing destructive is exercised.
"""

from datetime import date
from decimal import Decimal

import pytest

from models.auth import User
from models.database import Account, Transaction
from routers import plaid_router
from routers.plaid_router import PlaidItem
from utils import auth as auth_utils
from utils.secret_box import decrypt_secret, encrypt_secret


ACCESS_TOKEN = "access-sandbox-abc123"


@pytest.fixture
def item(db_session, user):
    row = PlaidItem(
        user_id=user.id,
        access_token=encrypt_secret(ACCESS_TOKEN),
        item_id="plaid-item-abc",
        institution_name="Capital One",
        cursor="cursor-xyz",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


@pytest.fixture
def stranger(db_session):
    row = User(
        email="stranger@example.com",
        username="stranger1",
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
    token = auth_utils.create_access_token({"sub": str(stranger.id), "sv": stranger.session_version})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def plaid_calls(monkeypatch):
    """Record every Plaid request; return a canned link token."""
    calls = []

    def fake_post(path, body):
        calls.append((path, body))
        if path == "/link/token/create":
            return {"link_token": "link-sandbox-update-token", "expiration": "2026-08-21T00:00:00Z"}
        raise AssertionError(f"unexpected Plaid call: {path}")

    monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)
    return calls


def _url(item_id: int) -> str:
    return f"/plaid/link-token/update/{item_id}"


# --- Authorization -----------------------------------------------------------
def test_requires_authentication(client, item):
    assert client.post(_url(item.id)).status_code == 401


def test_another_users_item_is_a_404(client, stranger_headers, item, plaid_calls):
    """Not 403: the caller has no business learning the item exists."""
    response = client.post(_url(item.id), headers=stranger_headers)
    assert response.status_code == 404
    # Rejected before any Plaid call, so no token is ever decrypted for them.
    assert plaid_calls == []


def test_an_unknown_item_is_a_404(client, auth_headers, plaid_calls):
    assert client.post(_url(999999), headers=auth_headers).status_code == 404
    assert plaid_calls == []


# --- The Plaid request shape -------------------------------------------------
def test_the_owner_gets_a_link_token(client, auth_headers, item, plaid_calls):
    response = client.post(_url(item.id), headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["link_token"] == "link-sandbox-update-token"


def test_the_existing_access_token_is_sent(client, auth_headers, item, plaid_calls):
    """This is what makes it update mode rather than a new connection."""
    client.post(_url(item.id), headers=auth_headers)
    path, body = plaid_calls[0]
    assert path == "/link/token/create"
    assert body["access_token"] == ACCESS_TOKEN


def test_products_is_omitted(client, auth_headers, item, plaid_calls):
    """Plaid errors on `products` in update mode unless adding a product."""
    client.post(_url(item.id), headers=auth_headers)
    _, body = plaid_calls[0]
    assert "products" not in body


def test_the_required_link_fields_are_present(client, auth_headers, item, user, plaid_calls):
    client.post(_url(item.id), headers=auth_headers)
    _, body = plaid_calls[0]
    assert body["user"] == {"client_user_id": str(user.id)}
    assert body["country_codes"] == ["US"]
    assert body["language"] == "en"
    assert body["client_name"] == "Financial Tracker"


def test_the_webhook_is_included_when_configured(client, auth_headers, item, plaid_calls, monkeypatch):
    monkeypatch.setattr(plaid_router, "PLAID_WEBHOOK_URL", "https://example.test/plaid/webhook")
    client.post(_url(item.id), headers=auth_headers)
    _, body = plaid_calls[0]
    assert body["webhook"] == "https://example.test/plaid/webhook"


def test_no_webhook_key_when_unconfigured(client, auth_headers, item, plaid_calls, monkeypatch):
    monkeypatch.setattr(plaid_router, "PLAID_WEBHOOK_URL", "")
    client.post(_url(item.id), headers=auth_headers)
    _, body = plaid_calls[0]
    assert "webhook" not in body


# --- Nothing leaks -----------------------------------------------------------
def test_the_response_never_carries_credentials(client, auth_headers, item, plaid_calls):
    body = client.post(_url(item.id), headers=auth_headers).text
    assert ACCESS_TOKEN not in body
    assert item.access_token not in body, "not the encrypted form either"
    # Plaid's own Item id is an identifier this endpoint has no reason to emit.
    assert "plaid-item-abc" not in body


def test_the_response_shape_is_exactly_what_link_needs(client, auth_headers, item, plaid_calls):
    payload = client.post(_url(item.id), headers=auth_headers).json()
    assert set(payload) == {"link_token", "id", "institution_name"}
    assert payload["id"] == item.id
    assert payload["institution_name"] == "Capital One"


def test_nothing_sensitive_is_logged(client, auth_headers, item, plaid_calls, caplog):
    with caplog.at_level("INFO"):
        client.post(_url(item.id), headers=auth_headers)
    logged = " ".join(record.getMessage() for record in caplog.records)
    assert ACCESS_TOKEN not in logged
    assert "link-sandbox-update-token" not in logged


# --- It changes nothing ------------------------------------------------------
def test_no_new_item_is_created(client, auth_headers, item, db_session, plaid_calls):
    before = db_session.query(PlaidItem).count()
    client.post(_url(item.id), headers=auth_headers)
    db_session.expire_all()
    assert db_session.query(PlaidItem).count() == before


def test_the_item_is_left_untouched(client, auth_headers, item, db_session, plaid_calls):
    """Cursor especially: losing it would replay the entire history."""
    client.post(_url(item.id), headers=auth_headers)

    db_session.expire_all()
    after = db_session.query(PlaidItem).filter_by(id=item.id).one()
    assert after.cursor == "cursor-xyz"
    assert after.item_id == "plaid-item-abc"
    assert after.institution_name == "Capital One"
    # Compare what it decrypts to, not the ciphertext: `encrypt_secret` is
    # nonce-based, so two encryptions of the same token differ by design and
    # comparing them directly would be a test that can only pass by accident.
    assert decrypt_secret(after.access_token) == ACCESS_TOKEN


def test_transactions_are_untouched(
    client, auth_headers, item, db_session, user, account, plaid_calls
):
    tx = Transaction(
        user_id=user.id, account_id=account.id, amount=Decimal("-20"),
        description="Imported", plaid_tx_id="tx-1", transaction_date=date(2026, 8, 1),
    )
    db_session.add(tx)
    db_session.commit()

    client.post(_url(item.id), headers=auth_headers)

    db_session.expire_all()
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-1").one_or_none() is not None


def test_account_balances_are_untouched(
    client, auth_headers, item, db_session, account, plaid_calls
):
    before = account.balance
    client.post(_url(item.id), headers=auth_headers)
    db_session.expire_all()
    assert db_session.query(Account).filter_by(id=account.id).one().balance == before


def test_the_sync_health_record_is_untouched(client, auth_headers, item, db_session, plaid_calls):
    """Requesting a repair token is not a sync and must not look like one."""
    client.post(_url(item.id), headers=auth_headers)
    db_session.expire_all()
    after = db_session.query(PlaidItem).filter_by(id=item.id).one()
    assert after.last_sync_at is None
    assert after.last_sync_ok is None


# --- Failure surfaces safely -------------------------------------------------
def test_a_plaid_failure_surfaces_as_502_without_detail(
    client, auth_headers, item, monkeypatch
):
    from fastapi import HTTPException

    def failing_post(path, body):
        raise HTTPException(status_code=502, detail="Plaid returned an error")

    monkeypatch.setattr(plaid_router, "_plaid_post", failing_post)

    response = client.post(_url(item.id), headers=auth_headers)
    assert response.status_code == 502
    assert ACCESS_TOKEN not in response.text


def test_a_plaid_failure_leaves_the_item_intact(client, auth_headers, item, db_session, monkeypatch):
    def failing_post(path, body):
        raise RuntimeError("plaid unreachable")

    monkeypatch.setattr(plaid_router, "_plaid_post", failing_post)

    try:
        client.post(_url(item.id), headers=auth_headers)
    except RuntimeError:
        pass  # TestClient re-raises unhandled errors; the point is the DB state.

    db_session.expire_all()
    after = db_session.query(PlaidItem).filter_by(id=item.id).one()
    assert after.cursor == "cursor-xyz"
