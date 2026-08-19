"""Sync-health diagnostics and mutation-during-pagination recovery.

Render Free has no shell, so `/plaid/sync-health` is the only way to see why a
connection is or is not syncing. It therefore has to be trustworthy in two
directions: it must surface enough to diagnose, and it must never surface a
credential.
"""

from datetime import date, datetime
from decimal import Decimal

import pytest

from models.auth import User
from models.database import Account, Transaction
from routers import plaid_router
from routers.plaid_router import (
    MAX_PAGINATION_RESTARTS,
    PlaidItem,
    PlaidMutationDuringPagination,
    SYNC_SOURCE_MANUAL,
    SYNC_SOURCE_WEBHOOK,
    WEBHOOK_MATCHES,
    WEBHOOK_MISMATCHED,
    WEBHOOK_NOT_REGISTERED,
    WEBHOOK_UNKNOWN,
)
from utils import auth as auth_utils
from utils.secret_box import encrypt_secret

EXPECTED_WEBHOOK = "https://api.example.com/plaid/webhook"
PLAID_ACCOUNT_ID = "acct-1"


@pytest.fixture
def item(db_session, user, account):
    account.plaid_account_id = PLAID_ACCOUNT_ID
    row = PlaidItem(
        user_id=user.id,
        access_token=encrypt_secret("super-secret-access-token"),
        item_id="item-1",
        institution_name="PNC",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def _item_get_payload(**overrides):
    payload = {
        "item": {
            "item_id": "item-1",
            "webhook": EXPECTED_WEBHOOK,
            "error": None,
            "consent_expiration_time": None,
        },
        "status": {
            "transactions": {
                "last_successful_update": "2026-08-10T12:00:00Z",
                "last_failed_update": None,
            },
            "last_webhook": {
                "sent_at": "2026-08-10T12:00:05Z",
                "code_sent": "SYNC_UPDATES_AVAILABLE",
            },
        },
    }
    payload["item"].update(overrides.pop("item", {}))
    payload["status"].update(overrides.pop("status", {}))
    return payload


def _stub_item_get(monkeypatch, payload):
    def fake_post(path, body):
        if path == "/item/get":
            return payload
        raise AssertionError(f"sync-health must not call {path}")

    monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)


# ─── Authentication and isolation ─────────────────────────────────────────────
def test_sync_health_requires_authentication(client):
    assert client.get("/plaid/sync-health").status_code == 401


def test_sync_health_only_returns_the_callers_items(
    client, db_session, user, auth_headers, item, monkeypatch
):
    other = User(
        email="other@example.com", username="other",
        hashed_password=auth_utils.get_password_hash("Password123"), is_verified=True,
    )
    db_session.add(other)
    db_session.commit()
    db_session.add(PlaidItem(
        user_id=other.id, access_token=encrypt_secret("theirs"),
        item_id="item-theirs", institution_name="Someone Else Bank",
    ))
    db_session.commit()

    monkeypatch.setenv("PLAID_WEBHOOK_URL", EXPECTED_WEBHOOK)
    monkeypatch.setattr(plaid_router, "PLAID_WEBHOOK_URL", EXPECTED_WEBHOOK)
    _stub_item_get(monkeypatch, _item_get_payload())

    body = client.get("/plaid/sync-health", headers=auth_headers).json()
    names = [row["institution_name"] for row in body["items"]]
    assert names == ["PNC"]
    assert "Someone Else Bank" not in str(body)


# ─── Secret safety ────────────────────────────────────────────────────────────
def test_sync_health_never_leaks_credentials(
    client, db_session, auth_headers, item, monkeypatch
):
    monkeypatch.setattr(plaid_router, "PLAID_WEBHOOK_URL", EXPECTED_WEBHOOK)
    monkeypatch.setattr(plaid_router, "PLAID_CLIENT_ID", "client-id-value")
    monkeypatch.setattr(plaid_router, "PLAID_SECRET", "plaid-secret-value")
    _stub_item_get(monkeypatch, _item_get_payload())

    raw = client.get("/plaid/sync-health", headers=auth_headers).text
    assert "super-secret-access-token" not in raw
    assert "plaid-secret-value" not in raw
    assert "client-id-value" not in raw
    assert item.access_token not in raw  # not even the ciphertext


# ─── Webhook classification ───────────────────────────────────────────────────
def _health_row(client, auth_headers, monkeypatch, payload, expected=EXPECTED_WEBHOOK):
    monkeypatch.setattr(plaid_router, "PLAID_WEBHOOK_URL", expected)
    _stub_item_get(monkeypatch, payload)
    return client.get("/plaid/sync-health", headers=auth_headers).json()["items"][0]


def test_matching_webhook_is_reported_as_matching(client, auth_headers, item, monkeypatch):
    row = _health_row(client, auth_headers, monkeypatch, _item_get_payload())
    assert row["webhook_status"] == WEBHOOK_MATCHES
    assert row["registered_webhook"] == EXPECTED_WEBHOOK


def test_missing_webhook_is_reported_as_not_registered(client, auth_headers, item, monkeypatch):
    row = _health_row(
        client, auth_headers, monkeypatch, _item_get_payload(item={"webhook": None})
    )
    assert row["webhook_status"] == WEBHOOK_NOT_REGISTERED
    assert row["registered_webhook"] is None


def test_stale_webhook_is_reported_as_mismatched(client, auth_headers, item, monkeypatch):
    row = _health_row(
        client, auth_headers, monkeypatch,
        _item_get_payload(item={"webhook": "https://old-host.onrender.com/plaid/webhook"}),
    )
    assert row["webhook_status"] == WEBHOOK_MISMATCHED
    assert row["registered_webhook"] == "https://old-host.onrender.com/plaid/webhook"


def test_unset_expected_url_yields_unknown_not_a_false_mismatch(client, auth_headers, item, monkeypatch):
    row = _health_row(client, auth_headers, monkeypatch, _item_get_payload(), expected="")
    assert row["webhook_status"] == WEBHOOK_UNKNOWN


def test_whitespace_difference_is_not_a_mismatch(client, auth_headers, item, monkeypatch):
    row = _health_row(
        client, auth_headers, monkeypatch,
        _item_get_payload(item={"webhook": f"  {EXPECTED_WEBHOOK}  "}),
    )
    assert row["webhook_status"] == WEBHOOK_MATCHES


# ─── Item error surfacing ─────────────────────────────────────────────────────
def test_login_required_is_surfaced(client, auth_headers, item, monkeypatch):
    row = _health_row(
        client, auth_headers, monkeypatch,
        _item_get_payload(item={"error": {
            "error_code": "ITEM_LOGIN_REQUIRED", "error_type": "ITEM_ERROR",
            "request_id": "should-not-appear",
        }}),
    )
    assert row["item_error_code"] == "ITEM_LOGIN_REQUIRED"
    assert row["login_repair_required"] is True


def test_item_error_request_id_is_not_echoed(client, auth_headers, item, monkeypatch):
    monkeypatch.setattr(plaid_router, "PLAID_WEBHOOK_URL", EXPECTED_WEBHOOK)
    _stub_item_get(monkeypatch, _item_get_payload(item={"error": {
        "error_code": "ITEM_LOGIN_REQUIRED", "error_type": "ITEM_ERROR",
        "request_id": "req-should-not-appear",
    }}))
    assert "req-should-not-appear" not in client.get("/plaid/sync-health", headers=auth_headers).text


def test_healthy_item_reports_no_repair_needed(client, auth_headers, item, monkeypatch):
    row = _health_row(client, auth_headers, monkeypatch, _item_get_payload())
    assert row["item_error_code"] is None
    assert row["login_repair_required"] is False
    assert row["plaid_last_successful_update"] == "2026-08-10T12:00:00Z"
    assert row["plaid_last_webhook_code"] == "SYNC_UPDATES_AVAILABLE"


def test_one_unreachable_item_does_not_hide_another(
    client, db_session, user, auth_headers, item, monkeypatch
):
    db_session.add(PlaidItem(
        user_id=user.id, access_token=encrypt_secret("second"),
        item_id="item-2", institution_name="Capital One",
    ))
    db_session.commit()
    monkeypatch.setattr(plaid_router, "PLAID_WEBHOOK_URL", EXPECTED_WEBHOOK)

    calls = {"n": 0}

    def flaky(path, body):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("plaid exploded")
        return _item_get_payload()

    monkeypatch.setattr(plaid_router, "_plaid_post", flaky)
    rows = client.get("/plaid/sync-health", headers=auth_headers).json()["items"]

    assert len(rows) == 2
    assert rows[0]["reachable"] is False
    assert rows[1]["reachable"] is True


# ─── Fintrack-side health record ──────────────────────────────────────────────
def test_cursor_initialization_is_reported(client, db_session, auth_headers, item, monkeypatch):
    row = _health_row(client, auth_headers, monkeypatch, _item_get_payload())
    assert row["cursor_initialized"] is False

    item.cursor = "cursor-abc"
    db_session.commit()
    row = _health_row(client, auth_headers, monkeypatch, _item_get_payload())
    assert row["cursor_initialized"] is True
    assert "cursor-abc" not in str(row)  # the value itself is not exposed


def _stub_sync(monkeypatch, added=1):
    def fake_post(path, body):
        if path == "/accounts/get":
            return {"accounts": [{
                "account_id": PLAID_ACCOUNT_ID, "name": "Primary Checking",
                "subtype": "checking", "balances": {"current": 100},
            }]}
        if path == "/transactions/sync":
            return {
                "added": [{
                    "transaction_id": f"tx-{i}", "account_id": PLAID_ACCOUNT_ID,
                    "amount": 5.0, "date": "2026-08-01", "name": "SHOP", "pending": False,
                } for i in range(added)],
                "modified": [], "removed": [], "next_cursor": "c1", "has_more": False,
            }
        raise AssertionError(path)

    monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)


def test_manual_sync_records_its_source(db_session, user, item, monkeypatch):
    _stub_sync(monkeypatch)
    plaid_router._do_sync_and_notify(item.id, user.id, SYNC_SOURCE_MANUAL)

    db_session.expire_all()
    refreshed = db_session.get(PlaidItem, item.id)
    assert refreshed.last_sync_source == SYNC_SOURCE_MANUAL
    assert refreshed.last_sync_ok is True
    assert refreshed.last_added_count == 1
    assert refreshed.last_sync_at is not None


def test_webhook_sync_records_its_source(db_session, user, item, monkeypatch):
    _stub_sync(monkeypatch)
    plaid_router._do_sync_and_notify(item.id, user.id, SYNC_SOURCE_WEBHOOK)

    db_session.expire_all()
    assert db_session.get(PlaidItem, item.id).last_sync_source == SYNC_SOURCE_WEBHOOK


def test_failed_sync_records_a_safe_error(db_session, user, item, monkeypatch):
    def boom(path, body):
        raise RuntimeError("plaid unavailable")

    monkeypatch.setattr(plaid_router, "_plaid_post", boom)
    plaid_router._do_sync_and_notify(item.id, user.id, SYNC_SOURCE_WEBHOOK)

    db_session.expire_all()
    refreshed = db_session.get(PlaidItem, item.id)
    assert refreshed.last_sync_ok is False
    assert "plaid unavailable" in refreshed.last_sync_error
    assert len(refreshed.last_sync_error) <= 300


def test_health_write_failure_never_breaks_a_sync(db_session, user, item, monkeypatch):
    """Observability must not be able to break the thing it observes."""
    _stub_sync(monkeypatch)
    monkeypatch.setattr(
        plaid_router, "record_sync_health",
        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("health write failed")),
    )
    # The sync itself must still complete and persist its transaction.
    try:
        plaid_router._do_sync_and_notify(item.id, user.id, SYNC_SOURCE_MANUAL)
    except Exception:
        pass
    db_session.expire_all()
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-0").count() == 1


# ─── Mutation during pagination ───────────────────────────────────────────────
def _paginating_stub(monkeypatch, *, mutate_on_page, total_pages=3, mutations=1):
    """Serve pages, raising the mutation error on `mutate_on_page` requests."""
    state = {"page": 0, "raised": 0, "cursors_seen": [], "restarts": 0}

    def fake_post(path, body):
        if path == "/accounts/get":
            return {"accounts": [{
                "account_id": PLAID_ACCOUNT_ID, "name": "Primary Checking",
                "subtype": "checking", "balances": {"current": 100},
            }]}
        if path != "/transactions/sync":
            raise AssertionError(path)

        cursor = body.get("cursor", "")
        state["cursors_seen"].append(cursor)
        if cursor == "":
            state["page"] = 0
            if state["cursors_seen"].count("") > 1:
                state["restarts"] += 1
        page = state["page"]

        if page + 1 == mutate_on_page and state["raised"] < mutations:
            state["raised"] += 1
            raise PlaidMutationDuringPagination("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION")

        state["page"] += 1
        return {
            "added": [{
                "transaction_id": f"tx-p{page}", "account_id": PLAID_ACCOUNT_ID,
                "amount": 5.0, "date": "2026-08-01", "name": "SHOP", "pending": False,
            }],
            "modified": [], "removed": [],
            "next_cursor": f"cursor-{page + 1}",
            "has_more": page + 1 < total_pages,
        }

    monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)
    return state


def test_mutation_on_page_two_restarts_from_the_original_cursor(
    db_session, user, item, monkeypatch
):
    state = _paginating_stub(monkeypatch, mutate_on_page=2)
    added = plaid_router._sync_item(db_session, item, user.id)

    # It restarted the cycle from the cursor it began with (empty), not from
    # the intermediate cursor the mutated cycle produced.
    assert state["restarts"] == 1
    assert state["cursors_seen"][0] == ""
    assert "" in state["cursors_seen"][1:]
    assert added >= 1


def test_restart_does_not_duplicate_already_stored_transactions(
    db_session, user, item, monkeypatch
):
    _paginating_stub(monkeypatch, mutate_on_page=2)
    plaid_router._sync_item(db_session, item, user.id)

    db_session.expire_all()
    rows = db_session.query(Transaction).filter(Transaction.user_id == user.id).all()
    ids = [r.plaid_tx_id for r in rows]
    assert len(ids) == len(set(ids)), "restart duplicated transactions"


def test_successful_retry_completes_the_sync(db_session, user, item, monkeypatch):
    _paginating_stub(monkeypatch, mutate_on_page=2, total_pages=3)
    plaid_router._sync_item(db_session, item, user.id)

    db_session.expire_all()
    refreshed = db_session.get(PlaidItem, item.id)
    # Finished the full cycle and stored the final cursor.
    assert refreshed.cursor == "cursor-3"
    assert db_session.query(Transaction).filter(Transaction.user_id == user.id).count() == 3


def test_repeated_mutation_hits_the_retry_limit_and_raises(db_session, user, item, monkeypatch):
    _paginating_stub(monkeypatch, mutate_on_page=1, mutations=99)
    with pytest.raises(PlaidMutationDuringPagination):
        plaid_router._sync_item(db_session, item, user.id)


def test_cursor_never_advances_past_uncommitted_data(db_session, user, item, monkeypatch):
    """After exhausting retries the cursor must still be the original."""
    item.cursor = "original-cursor"
    db_session.commit()

    def always_mutating(path, body):
        if path == "/accounts/get":
            return {"accounts": [{
                "account_id": PLAID_ACCOUNT_ID, "name": "Primary Checking",
                "subtype": "checking", "balances": {"current": 100},
            }]}
        raise PlaidMutationDuringPagination("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION")

    monkeypatch.setattr(plaid_router, "_plaid_post", always_mutating)
    with pytest.raises(PlaidMutationDuringPagination):
        plaid_router._sync_item(db_session, item, user.id)

    db_session.expire_all()
    assert db_session.get(PlaidItem, item.id).cursor == "original-cursor"


def test_retry_limit_is_bounded(db_session, user, item, monkeypatch):
    state = _paginating_stub(monkeypatch, mutate_on_page=1, mutations=99)
    with pytest.raises(PlaidMutationDuringPagination):
        plaid_router._sync_item(db_session, item, user.id)
    # One initial attempt plus MAX_PAGINATION_RESTARTS retries, no more.
    assert state["raised"] == MAX_PAGINATION_RESTARTS + 1
