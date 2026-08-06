"""The recurring add-on probe classifies Plaid's answers without guessing.

`/transactions/recurring/get` is an optional add-on: holding the Transactions
product says nothing about whether it is enabled. The probe must tell
"not entitled" apart from "temporarily broken" apart from "enabled but no
streams yet", and must never take normal transaction sync down with it.
"""

import pytest

from routers import plaid_router
from routers.plaid_router import (
    CAPABILITY_AVAILABLE,
    CAPABILITY_ERROR,
    CAPABILITY_NO_STREAMS,
    CAPABILITY_UNAVAILABLE,
)


class _Response:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.ok = 200 <= status_code < 300

    def json(self):
        if self._payload is _INVALID:
            raise ValueError("not json")
        return self._payload


_INVALID = object()


def _probe_with(monkeypatch, payload, status_code=200):
    monkeypatch.setattr(plaid_router, "PLAID_CLIENT_ID", "client-id")
    monkeypatch.setattr(plaid_router, "PLAID_SECRET", "secret")
    monkeypatch.setattr(
        plaid_router.requests, "post", lambda *a, **k: _Response(payload, status_code)
    )
    return plaid_router._probe_recurring_for_item("access-token")


def test_streams_returned_means_available(monkeypatch):
    result = _probe_with(monkeypatch, {
        "inflow_streams": [{"stream_id": "a"}],
        "outflow_streams": [{"stream_id": "b"}, {"stream_id": "c"}],
    })
    assert result["status"] == CAPABILITY_AVAILABLE
    assert result["inflow_streams"] == 1
    assert result["outflow_streams"] == 2


def test_empty_streams_is_distinct_from_unavailable(monkeypatch):
    result = _probe_with(monkeypatch, {"inflow_streams": [], "outflow_streams": []})
    assert result["status"] == CAPABILITY_NO_STREAMS


@pytest.mark.parametrize(
    "code",
    ["PRODUCT_NOT_ENABLED", "PRODUCTS_NOT_SUPPORTED", "INVALID_PRODUCT", "NOT_ENTITLED"],
)
def test_entitlement_errors_report_unavailable(monkeypatch, code):
    result = _probe_with(monkeypatch, {"error_code": code, "error_message": "nope"})
    assert result["status"] == CAPABILITY_UNAVAILABLE
    assert result["plaid_error_code"] == code


def test_transient_error_is_not_reported_as_unavailable(monkeypatch):
    result = _probe_with(monkeypatch, {"error_code": "INTERNAL_SERVER_ERROR"})
    assert result["status"] == CAPABILITY_ERROR
    assert result["plaid_error_code"] == "INTERNAL_SERVER_ERROR"


def test_non_json_response_is_an_error_not_a_crash(monkeypatch):
    result = _probe_with(monkeypatch, _INVALID, status_code=502)
    assert result["status"] == CAPABILITY_ERROR


def test_network_failure_is_an_error_not_a_crash(monkeypatch):
    monkeypatch.setattr(plaid_router, "PLAID_CLIENT_ID", "client-id")
    monkeypatch.setattr(plaid_router, "PLAID_SECRET", "secret")

    def boom(*a, **k):
        raise plaid_router.requests.RequestException("down")

    monkeypatch.setattr(plaid_router.requests, "post", boom)
    result = plaid_router._probe_recurring_for_item("access-token")
    assert result["status"] == CAPABILITY_ERROR


def test_probe_response_never_leaks_credentials(monkeypatch):
    result = _probe_with(monkeypatch, {"inflow_streams": [], "outflow_streams": []})
    serialized = repr(result)
    assert "access-token" not in serialized
    assert "secret" not in serialized
    assert "client-id" not in serialized


def test_sync_still_works_when_the_addon_is_unavailable(monkeypatch, db_session, user, account):
    """The add-on being absent must not affect ordinary transaction sync."""
    from utils.secret_box import encrypt_secret
    from models.database import Transaction

    account.plaid_account_id = "acct-1"
    item = plaid_router.PlaidItem(
        user_id=user.id,
        access_token=encrypt_secret("access-token"),
        item_id="item-x",
        institution_name="Test Bank",
    )
    db_session.add(item)
    db_session.commit()

    def fake_post(path, body):
        if path == "/accounts/get":
            return {"accounts": [{
                "account_id": "acct-1", "name": "Primary Checking",
                "subtype": "checking", "balances": {"current": 100},
            }]}
        if path == "/transactions/sync":
            return {
                "added": [{
                    "transaction_id": "tx-1", "account_id": "acct-1", "amount": 5.0,
                    "date": "2026-03-02", "name": "CORNER SHOP", "pending": False,
                }],
                "modified": [], "removed": [], "next_cursor": "c1", "has_more": False,
            }
        raise AssertionError(f"sync must not call {path}")

    monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)
    added = plaid_router._sync_item(db_session, item, user.id)

    assert added == 1
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-1").count() == 1
