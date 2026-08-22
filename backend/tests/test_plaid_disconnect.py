"""Disconnect, and the escape hatch for when it cannot succeed.

Disconnect used to swallow a failed `/item/remove`, delete the local row
anyway, and report success — which could leave a live Item at Plaid with the
only record capable of reconciling it destroyed. The remote call now gates the
local delete.

One error is treated as success. Plaid documents `ITEM_NOT_FOUND` as meaning
the Item "does not exist, has been previously removed via /item/remove, or has
had access removed by the user", which is terminal proof there is nothing left
to remove. `INVALID_ACCESS_TOKEN` is deliberately *not* treated that way: an
unusable token says nothing about whether the Item is alive.

Historical data is untouched by either path. Disconnect stops future updates;
it is not Reset, and these tests pin that distinction.

Every Plaid call is mocked. Nothing here touches the real API.
"""

from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException

from models.auth import User
from models.database import Account, Category, RecurringTransaction, Transaction
from routers import plaid_router
from routers.plaid_router import PlaidItem, PlaidItemNotFound
from utils import auth as auth_utils
from utils.secret_box import encrypt_secret


ACCESS_TOKEN = "access-sandbox-disconnect"
CURSOR = "cursor-should-survive-nothing"


@pytest.fixture
def item(db_session, user, account):
    account.plaid_account_id = "plaid-acct-disc"
    row = PlaidItem(
        user_id=user.id,
        access_token=encrypt_secret(ACCESS_TOKEN),
        item_id="plaid-item-disc",
        institution_name="Capital One",
        cursor=CURSOR,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


@pytest.fixture
def stranger_headers(db_session):
    row = User(
        email="stranger-disc@example.com",
        username="strangerdisc",
        hashed_password=auth_utils.get_password_hash("Password123"),
        is_verified=True,
        is_admin=False,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    token = auth_utils.create_access_token({"sub": str(row.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def plaid_ok(monkeypatch):
    calls = []

    def fake_post(path, body):
        calls.append(path)
        return {"request_id": "req-1"}

    monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)
    return calls


@pytest.fixture
def forbid_plaid(monkeypatch):
    """Any Plaid call from the force-local path is a bug."""
    def explode(path, body):
        raise AssertionError(f"remove-local must make no Plaid call, but called {path}")

    monkeypatch.setattr(plaid_router, "_plaid_post", explode)


def _seed_history(db_session, user, account, category):
    db_session.add(Transaction(
        user_id=user.id, account_id=account.id, category_id=category.id,
        amount=Decimal("-42"), description="Imported", plaid_tx_id="tx-keepme",
        transaction_date=date(2026, 8, 1),
    ))
    db_session.add(RecurringTransaction(
        user_id=user.id, account_id=account.id, category_id=category.id,
        amount=Decimal("-9.99"), description="Netflix",
        period="monthly", next_date=date(2026, 9, 1),
    ))
    db_session.commit()


# --- Authorization -----------------------------------------------------------
def test_disconnect_requires_authentication(client, item):
    assert client.delete(f"/plaid/items/{item.id}").status_code == 401


def test_disconnect_rejects_another_users_item(client, stranger_headers, item, db_session, plaid_ok):
    response = client.delete(f"/plaid/items/{item.id}", headers=stranger_headers)
    assert response.status_code == 404
    # Rejected before any Plaid call — no token decrypted for a stranger.
    assert plaid_ok == []
    db_session.expire_all()
    assert db_session.query(PlaidItem).filter_by(id=item.id).one_or_none() is not None


def test_disconnect_unknown_item_is_404(client, auth_headers, plaid_ok):
    assert client.delete("/plaid/items/999999", headers=auth_headers).status_code == 404
    assert plaid_ok == []


# --- The happy path ----------------------------------------------------------
def test_remote_success_removes_the_local_row(client, auth_headers, item, db_session, plaid_ok):
    item_id = item.id
    response = client.delete(f"/plaid/items/{item_id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["message"] == "Bank disconnected."
    assert "/item/remove" in plaid_ok

    db_session.expire_all()
    assert db_session.query(PlaidItem).filter_by(id=item_id).one_or_none() is None


# --- The bug this phase fixes ------------------------------------------------
def test_a_plaid_failure_keeps_the_connection(client, auth_headers, item, db_session, monkeypatch):
    """The old behaviour deleted the row anyway and said "Bank disconnected."."""
    def failing_post(path, body):
        raise HTTPException(status_code=502, detail="Plaid returned an error")

    monkeypatch.setattr(plaid_router, "_plaid_post", failing_post)

    response = client.delete(f"/plaid/items/{item.id}", headers=auth_headers)
    assert response.status_code == 502
    assert "try again" in response.json()["detail"].lower()

    db_session.expire_all()
    assert db_session.query(PlaidItem).filter_by(id=item.id).one_or_none() is not None


def test_a_network_failure_keeps_the_connection(client, auth_headers, item, db_session, monkeypatch):
    def failing_post(path, body):
        raise RuntimeError("plaid unreachable")

    monkeypatch.setattr(plaid_router, "_plaid_post", failing_post)

    assert client.delete(f"/plaid/items/{item.id}", headers=auth_headers).status_code == 502
    db_session.expire_all()
    assert db_session.query(PlaidItem).filter_by(id=item.id).one_or_none() is not None


def test_an_invalid_token_is_not_treated_as_proof_of_removal(
    client, auth_headers, item, db_session, monkeypatch
):
    """A token can be unusable while the Item is very much alive."""
    def failing_post(path, body):
        raise HTTPException(status_code=502, detail="Plaid returned an error")

    monkeypatch.setattr(plaid_router, "_plaid_post", failing_post)

    assert client.delete(f"/plaid/items/{item.id}", headers=auth_headers).status_code == 502
    db_session.expire_all()
    assert db_session.query(PlaidItem).filter_by(id=item.id).one_or_none() is not None


def test_the_failure_response_leaks_nothing(client, auth_headers, item, monkeypatch):
    def failing_post(path, body):
        raise HTTPException(status_code=502, detail="Plaid returned an error")

    monkeypatch.setattr(plaid_router, "_plaid_post", failing_post)

    body = client.delete(f"/plaid/items/{item.id}", headers=auth_headers).text
    assert ACCESS_TOKEN not in body
    assert CURSOR not in body
    assert "plaid-item-disc" not in body


# --- The one error that means "already gone" ---------------------------------
def test_item_not_found_completes_the_local_removal(
    client, auth_headers, item, db_session, monkeypatch
):
    """Plaid documents ITEM_NOT_FOUND as terminal proof the Item is gone."""
    def already_gone(path, body):
        raise PlaidItemNotFound()

    monkeypatch.setattr(plaid_router, "_plaid_post", already_gone)

    item_id = item.id
    response = client.delete(f"/plaid/items/{item_id}", headers=auth_headers)
    assert response.status_code == 200

    db_session.expire_all()
    assert db_session.query(PlaidItem).filter_by(id=item_id).one_or_none() is None


def test_a_retry_after_remote_success_finishes_locally(
    client, auth_headers, item, db_session, monkeypatch
):
    """The recovery for remote-success-then-local-failure, without extra state.

    The first attempt removes the Item at Plaid but fails to commit locally.
    Retrying calls `/item/remove` again, Plaid answers ITEM_NOT_FOUND, and that
    branch finishes the delete — which is why no reconciliation job is needed.
    """
    removed_remotely = {"done": False}

    def post(path, body):
        if removed_remotely["done"]:
            raise PlaidItemNotFound()
        removed_remotely["done"] = True
        return {"request_id": "req-1"}

    monkeypatch.setattr(plaid_router, "_plaid_post", post)

    # Simulate the local commit failing on the first attempt.
    real_commit = plaid_router.Session.commit

    def boom(self):
        raise RuntimeError("database unavailable")

    item_id = item.id
    monkeypatch.setattr(plaid_router.Session, "commit", boom)
    first = client.delete(f"/plaid/items/{item_id}", headers=auth_headers)
    assert first.status_code == 500
    assert "could not finish" in first.json()["detail"].lower()

    monkeypatch.setattr(plaid_router.Session, "commit", real_commit)
    db_session.expire_all()
    assert db_session.query(PlaidItem).filter_by(id=item_id).one_or_none() is not None

    second = client.delete(f"/plaid/items/{item_id}", headers=auth_headers)
    assert second.status_code == 200
    db_session.expire_all()
    assert db_session.query(PlaidItem).filter_by(id=item_id).one_or_none() is None


# --- Historical data is not Reset --------------------------------------------
def test_disconnect_preserves_history(
    client, auth_headers, item, db_session, user, account, category, plaid_ok
):
    _seed_history(db_session, user, account, category)
    account_id, category_id = account.id, category.id

    assert client.delete(f"/plaid/items/{item.id}", headers=auth_headers).status_code == 200

    db_session.expire_all()
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-keepme").one_or_none() is not None
    assert db_session.query(Account).filter_by(id=account_id).one_or_none() is not None
    assert db_session.query(Category).filter_by(id=category_id).one_or_none() is not None
    assert db_session.query(RecurringTransaction).count() == 1


def test_disconnect_leaves_account_balances_alone(
    client, auth_headers, item, db_session, account, plaid_ok
):
    before = account.balance
    assert client.delete(f"/plaid/items/{item.id}", headers=auth_headers).status_code == 200
    db_session.expire_all()
    assert db_session.query(Account).filter_by(id=account.id).one().balance == before


# --- Force-local removal ------------------------------------------------------
def _local_url(item_id: int) -> str:
    return f"/plaid/items/{item_id}/remove-local"


def test_force_local_requires_authentication(client, item):
    assert client.post(_local_url(item.id)).status_code == 401


def test_force_local_rejects_another_users_item(
    client, stranger_headers, item, db_session, forbid_plaid
):
    assert client.post(_local_url(item.id), headers=stranger_headers).status_code == 404
    db_session.expire_all()
    assert db_session.query(PlaidItem).filter_by(id=item.id).one_or_none() is not None


def test_force_local_unknown_item_is_404(client, auth_headers, forbid_plaid):
    assert client.post(_local_url(999999), headers=auth_headers).status_code == 404


def test_force_local_makes_no_plaid_call(client, auth_headers, item, db_session, forbid_plaid):
    """The defining property: it cannot claim a removal it never attempted."""
    item_id = item.id
    response = client.post(_local_url(item_id), headers=auth_headers)
    assert response.status_code == 200

    db_session.expire_all()
    assert db_session.query(PlaidItem).filter_by(id=item_id).one_or_none() is None


def test_force_local_says_removal_was_not_confirmed(client, auth_headers, item, forbid_plaid):
    payload = client.post(_local_url(item.id), headers=auth_headers).json()
    assert payload["remote_removal_confirmed"] is False
    assert "not confirmed" in payload["message"].lower()
    # It must not read like an ordinary successful disconnect.
    assert payload["message"] != "Bank disconnected."


def test_force_local_preserves_history(
    client, auth_headers, item, db_session, user, account, category, forbid_plaid
):
    _seed_history(db_session, user, account, category)

    assert client.post(_local_url(item.id), headers=auth_headers).status_code == 200

    db_session.expire_all()
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-keepme").one_or_none() is not None
    assert db_session.query(RecurringTransaction).count() == 1
    assert db_session.query(Account).filter_by(id=account.id).one_or_none() is not None


def test_force_local_leaks_nothing(client, auth_headers, item, forbid_plaid):
    body = client.post(_local_url(item.id), headers=auth_headers).text
    assert ACCESS_TOKEN not in body
    assert CURSOR not in body
    assert "plaid-item-disc" not in body


def test_force_local_is_logged_as_unconfirmed(client, auth_headers, item, forbid_plaid, caplog):
    with caplog.at_level("WARNING", logger="routers.plaid_router"):
        client.post(_local_url(item.id), headers=auth_headers)

    messages = [record.getMessage() for record in caplog.records]
    assert any("removed_locally_without_remote_confirmation" in message for message in messages)
    assert not any(ACCESS_TOKEN in message for message in messages)


# --- Part 10: webhooks for an Item Fintrack no longer knows about -------------
# Force-local removal deliberately leaves a live Item at Plaid, so it will keep
# sending webhooks for an `item_id` that matches no local row. That is the one
# ongoing consequence of the escape hatch, and it must stay harmless.
def _post_webhook(client, plaid_item_id, monkeypatch, code="SYNC_UPDATES_AVAILABLE"):
    scheduled = []
    monkeypatch.setattr(plaid_router, "_verify_plaid_webhook", lambda body, token: True)
    monkeypatch.setattr(
        plaid_router,
        "_do_sync_and_notify",
        lambda item_id, user_id, source: scheduled.append(item_id),
    )
    response = client.post(
        "/plaid/webhook",
        json={"webhook_type": "TRANSACTIONS", "webhook_code": code, "item_id": plaid_item_id},
        headers={"Plaid-Verification": "signed"},
    )
    return response, scheduled


def test_webhook_for_a_force_removed_item_is_ignored_safely(
    client, auth_headers, item, db_session, monkeypatch, forbid_plaid
):
    plaid_item_id = item.item_id
    assert client.post(_local_url(item.id), headers=auth_headers).status_code == 200

    response, scheduled = _post_webhook(client, plaid_item_id, monkeypatch)

    # 200, because a retry storm helps nobody: there is nothing to deliver to.
    assert response.status_code == 200
    assert scheduled == []
    # And no row is resurrected by the delivery.
    db_session.expire_all()
    assert db_session.query(PlaidItem).filter_by(item_id=plaid_item_id).one_or_none() is None


def test_webhook_for_a_live_item_still_schedules_a_sync(client, item, db_session, monkeypatch):
    """The counterpart, so the test above cannot pass by webhooks being broken."""
    response, scheduled = _post_webhook(client, item.item_id, monkeypatch)

    assert response.status_code == 200
    assert scheduled == [item.id]
