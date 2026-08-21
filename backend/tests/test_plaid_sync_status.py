"""`GET /plaid/sync-status` — local sync progress, with no Plaid traffic.

This endpoint exists so a client can watch a manual sync finish without
hammering `/plaid/sync-health`, which makes one live `/item/get` per Item. Its
defining property is therefore a *negative* one: it must make no Plaid call at
all. Several tests below assert that by replacing `_plaid_post` with something
that fails loudly if it is ever reached.

Everything it returns is either Fintrack's own record or an identifier the
caller already has. No credential, no cursor, no Plaid Item id.
"""

from datetime import datetime

import pytest

from models.auth import User
from routers import plaid_router
from routers.plaid_router import PlaidItem
from utils import auth as auth_utils
from utils.secret_box import encrypt_secret


ACCESS_TOKEN = "access-sandbox-status"
CURSOR = "cursor-should-never-be-exposed"


@pytest.fixture
def item(db_session, user):
    row = PlaidItem(
        user_id=user.id,
        access_token=encrypt_secret(ACCESS_TOKEN),
        item_id="plaid-item-status",
        institution_name="Capital One",
        cursor=CURSOR,
        last_sync_at=datetime(2026, 8, 20, 18, 0, 0),
        last_sync_ok=True,
        last_sync_source="manual",
        last_added_count=2,
        last_modified_count=1,
        last_removed_count=0,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


@pytest.fixture
def stranger_headers(db_session):
    row = User(
        email="stranger-status@example.com",
        username="strangerstatus",
        hashed_password=auth_utils.get_password_hash("Password123"),
        is_verified=True,
        is_admin=False,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    token = auth_utils.create_access_token({"sub": str(row.id), "sv": row.session_version})
    return {"Authorization": f"Bearer {token}"}, row


@pytest.fixture
def forbid_plaid(monkeypatch):
    """Any Plaid call from this endpoint is a bug, so make one impossible to miss."""
    def explode(path, body):
        raise AssertionError(f"sync-status must make no Plaid call, but called {path}")

    monkeypatch.setattr(plaid_router, "_plaid_post", explode)


# --- Authorization -----------------------------------------------------------
def test_requires_authentication(client):
    assert client.get("/plaid/sync-status").status_code == 401


def test_returns_only_the_callers_items(client, auth_headers, item, stranger_headers, db_session, forbid_plaid):
    _, stranger = stranger_headers
    theirs = PlaidItem(
        user_id=stranger.id,
        access_token=encrypt_secret("their-token"),
        item_id="plaid-item-theirs",
        institution_name="Their Bank",
    )
    db_session.add(theirs)
    db_session.commit()
    db_session.refresh(theirs)

    rows = client.get("/plaid/sync-status", headers=auth_headers).json()["items"]
    assert [row["id"] for row in rows] == [item.id]


def test_a_stranger_sees_their_own_items_only(client, stranger_headers, item, forbid_plaid):
    headers, _ = stranger_headers
    rows = client.get("/plaid/sync-status", headers=headers).json()["items"]
    assert rows == []


# --- The defining property: no Plaid traffic ---------------------------------
def test_makes_no_plaid_call(client, auth_headers, item, forbid_plaid):
    """The whole reason this endpoint exists rather than polling sync-health."""
    response = client.get("/plaid/sync-status", headers=auth_headers)
    assert response.status_code == 200


def test_still_makes_no_plaid_call_with_several_items(
    client, auth_headers, item, db_session, user, forbid_plaid
):
    for index in range(3):
        db_session.add(PlaidItem(
            user_id=user.id,
            access_token=encrypt_secret(f"token-{index}"),
            item_id=f"plaid-item-{index}",
            institution_name=f"Bank {index}",
        ))
    db_session.commit()

    rows = client.get("/plaid/sync-status", headers=auth_headers).json()["items"]
    assert len(rows) == 4


# --- Nothing sensitive leaves --------------------------------------------------
def test_never_leaks_credentials_or_identifiers(client, auth_headers, item, forbid_plaid):
    body = client.get("/plaid/sync-status", headers=auth_headers).text
    assert ACCESS_TOKEN not in body
    assert item.access_token not in body, "not the encrypted form either"
    assert CURSOR not in body
    assert "plaid-item-status" not in body, "Plaid's Item id is not the caller's business"


def test_the_row_shape_is_exactly_what_polling_needs(client, auth_headers, item, forbid_plaid):
    rows = client.get("/plaid/sync-status", headers=auth_headers).json()["items"]
    assert set(rows[0]) == {
        "id",
        "institution_name",
        "last_sync_at",
        "last_sync_ok",
        "last_sync_error",
        "last_sync_source",
        "last_added_count",
        "last_modified_count",
        "last_removed_count",
    }


# --- Serialization -------------------------------------------------------------
def test_a_successful_sync_serializes_its_counts(client, auth_headers, item, forbid_plaid):
    row = client.get("/plaid/sync-status", headers=auth_headers).json()["items"][0]
    assert row["last_sync_ok"] is True
    assert row["last_sync_error"] is None
    assert row["last_sync_source"] == "manual"
    assert (row["last_added_count"], row["last_modified_count"], row["last_removed_count"]) == (2, 1, 0)
    assert row["last_sync_at"].startswith("2026-08-20T18:00:00")


def test_a_failed_sync_serializes_its_error(client, auth_headers, item, db_session, forbid_plaid):
    item.last_sync_ok = False
    item.last_sync_error = "HTTPException: Plaid returned an error"
    db_session.commit()

    row = client.get("/plaid/sync-status", headers=auth_headers).json()["items"][0]
    assert row["last_sync_ok"] is False
    assert row["last_sync_error"] == "HTTPException: Plaid returned an error"


def test_null_observability_fields_are_supported(client, auth_headers, db_session, user, forbid_plaid):
    """Connections predating the health columns have nothing recorded at all."""
    db_session.add(PlaidItem(
        user_id=user.id,
        access_token=encrypt_secret("legacy-token"),
        item_id="plaid-item-legacy",
        institution_name="Legacy Bank",
    ))
    db_session.commit()

    row = [
        r for r in client.get("/plaid/sync-status", headers=auth_headers).json()["items"]
        if r["institution_name"] == "Legacy Bank"
    ][0]
    assert row["last_sync_at"] is None
    assert row["last_sync_ok"] is None
    assert row["last_added_count"] is None


def test_items_report_independently(client, auth_headers, item, db_session, user, forbid_plaid):
    second = PlaidItem(
        user_id=user.id,
        access_token=encrypt_secret("second-token"),
        item_id="plaid-item-second",
        institution_name="PNC",
        last_sync_at=datetime(2026, 8, 20, 17, 0, 0),
        last_sync_ok=False,
        last_sync_error="boom",
        last_added_count=0,
    )
    db_session.add(second)
    db_session.commit()

    rows = {r["institution_name"]: r for r in client.get("/plaid/sync-status", headers=auth_headers).json()["items"]}
    assert rows["Capital One"]["last_sync_ok"] is True
    assert rows["PNC"]["last_sync_ok"] is False
    assert rows["PNC"]["last_sync_error"] == "boom"


def test_no_connected_banks_is_an_empty_list_not_an_error(client, auth_headers, forbid_plaid):
    """Unlike `POST /sync`, which 404s — polling must not treat that as failure."""
    response = client.get("/plaid/sync-status", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["items"] == []
