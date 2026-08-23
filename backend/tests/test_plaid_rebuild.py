"""Rebuild bank history — `POST /plaid/replay`, and what makes it safe to offer.

The endpoint clears every cursor so the next sync re-reads the full available
window. That sounds destructive and is not, for one specific reason: re-offered
rows hit `pg_insert(...).on_conflict_do_nothing()` on the unique `plaid_tx_id`,
so an existing row is *skipped entirely* — not updated, not duplicated. Every
claim the UI makes about rebuilding ("existing transactions are matched rather
than duplicated", "your filings are kept") rests on that, so it is pinned here
rather than assumed.

These tests drive the real sync path with a stubbed Plaid transport, because
the guarantee lives in the insert, not in the endpoint.

Every Plaid call is mocked. Nothing here touches the real API.
"""

from datetime import date
from decimal import Decimal

import pytest

from models.auth import User
from models.database import Account, Transaction
from routers import plaid_router
from routers.plaid_router import PlaidItem
from utils import auth as auth_utils
from utils.secret_box import encrypt_secret


PLAID_ACCOUNT_ID = "plaid-acct-rebuild"
ACCESS_TOKEN = "access-sandbox-rebuild"


@pytest.fixture
def item(db_session, user, account):
    account.plaid_account_id = PLAID_ACCOUNT_ID
    row = PlaidItem(
        user_id=user.id,
        access_token=encrypt_secret(ACCESS_TOKEN),
        item_id="item-rebuild-1",
        institution_name="Test Bank",
        cursor="cursor-established",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


@pytest.fixture
def other_user(db_session):
    row = User(
        email="other-rebuild@example.com",
        username="otherrebuild",
        hashed_password=auth_utils.get_password_hash("Password123"),
        is_verified=True,
        is_admin=False,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def _plaid_tx(tx_id: str, amount: str, name: str = "Coffee", tx_date: str = "2026-08-01"):
    """One posted transaction in Plaid's shape. Plaid positive = money out."""
    return {
        "transaction_id": tx_id,
        "account_id": PLAID_ACCOUNT_ID,
        "amount": amount,
        "name": name,
        "date": tx_date,
        "pending": False,
    }


@pytest.fixture
def plaid_history(monkeypatch):
    """A bank that always returns the same two-transaction history.

    Deliberately ignores the cursor, which is exactly what a rebuild sees: a
    null cursor makes Plaid return the whole window from the beginning.
    """
    history = [_plaid_tx("tx-1", "12.50"), _plaid_tx("tx-2", "40.00", name="Groceries")]
    calls = {"sync": 0, "cursors": []}

    def fake_post(path, body):
        if path == "/accounts/get":
            return {"accounts": [{
                "account_id": PLAID_ACCOUNT_ID,
                "name": "Primary Checking",
                "subtype": "checking",
                "balances": {"current": 900},
            }]}
        if path == "/transactions/sync":
            calls["sync"] += 1
            calls["cursors"].append(body.get("cursor"))
            return {
                "added": history,
                "modified": [],
                "removed": [],
                "next_cursor": "cursor-after-rebuild",
                "has_more": False,
            }
        return {}

    monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)
    return calls


def _rebuild(db_session, item, user):
    """Run what the endpoint queues: cursor cleared, then a real sync."""
    item.cursor = None
    db_session.commit()
    return plaid_router._sync_item(db_session, item, user.id)


# --- The endpoint itself -----------------------------------------------------
def test_rebuild_requires_authentication(client):
    assert client.post("/plaid/replay").status_code == 401


def test_rebuild_with_no_banks_is_404(client, auth_headers):
    assert client.post("/plaid/replay", headers=auth_headers).status_code == 404


def test_rebuild_clears_the_cursor(client, auth_headers, db_session, item, monkeypatch):
    # The queued background work is not what this test is about.
    monkeypatch.setattr(plaid_router, "_do_sync_and_notify", lambda *args, **kwargs: None)

    assert client.post("/plaid/replay", headers=auth_headers).status_code == 200

    db_session.expire_all()
    assert db_session.query(PlaidItem).filter_by(id=item.id).one().cursor is None


def test_rebuild_leaves_another_users_connection_alone(
    client, auth_headers, db_session, other_user, item, monkeypatch
):
    monkeypatch.setattr(plaid_router, "_do_sync_and_notify", lambda *args, **kwargs: None)
    theirs = PlaidItem(
        user_id=other_user.id,
        access_token=encrypt_secret("their-token"),
        item_id="item-theirs",
        institution_name="Their Bank",
        cursor="their-cursor",
    )
    db_session.add(theirs)
    db_session.commit()

    client.post("/plaid/replay", headers=auth_headers)

    db_session.expire_all()
    assert db_session.query(PlaidItem).filter_by(id=theirs.id).one().cursor == "their-cursor"


def test_rebuild_queues_one_sync_per_bank(client, auth_headers, db_session, user, item, monkeypatch):
    queued = []
    monkeypatch.setattr(
        plaid_router, "_do_sync_and_notify",
        lambda item_id, user_id, source: queued.append((item_id, source)),
    )
    second = PlaidItem(
        user_id=user.id,
        access_token=encrypt_secret("token-2"),
        item_id="item-rebuild-2",
        institution_name="Second Bank",
    )
    db_session.add(second)
    db_session.commit()

    client.post("/plaid/replay", headers=auth_headers)

    assert sorted(item_id for item_id, _ in queued) == sorted([item.id, second.id])
    # Recorded as a manual run, which is what makes `/plaid/sync-status`
    # polling work for a rebuild without any second mechanism.
    assert {source for _, source in queued} == {plaid_router.SYNC_SOURCE_MANUAL}


def test_rebuild_response_leaks_nothing(client, auth_headers, item, monkeypatch):
    monkeypatch.setattr(plaid_router, "_do_sync_and_notify", lambda *args, **kwargs: None)
    body = client.post("/plaid/replay", headers=auth_headers).text
    assert ACCESS_TOKEN not in body
    assert "cursor-established" not in body
    assert "item-rebuild-1" not in body


# --- The guarantee the copy depends on ---------------------------------------
def test_a_rebuild_does_not_duplicate_what_is_already_stored(
    db_session, user, account, item, plaid_history
):
    first = _rebuild(db_session, item, user)
    assert first == 2

    second = _rebuild(db_session, item, user)

    # Same history re-offered in full, absorbed by ON CONFLICT DO NOTHING.
    assert second == 0
    assert db_session.query(Transaction).filter_by(user_id=user.id).count() == 2


def test_repeated_rebuilds_stay_stable(db_session, user, account, item, plaid_history):
    for _ in range(4):
        _rebuild(db_session, item, user)

    rows = db_session.query(Transaction).filter_by(user_id=user.id).all()
    assert len(rows) == 2
    assert sorted(row.plaid_tx_id for row in rows) == ["tx-1", "tx-2"]


def test_a_rebuild_keeps_the_category_you_filed(
    db_session, user, account, category, item, plaid_history
):
    _rebuild(db_session, item, user)
    filed = db_session.query(Transaction).filter_by(plaid_tx_id="tx-1").one()
    filed.category_id = category.id
    filed.category_source = "user"
    db_session.commit()

    _rebuild(db_session, item, user)

    db_session.expire_all()
    after = db_session.query(Transaction).filter_by(plaid_tx_id="tx-1").one()
    assert after.category_id == category.id
    assert after.category_source == "user"


def test_a_rebuild_keeps_transaction_ids_stable(db_session, user, account, item, plaid_history):
    """Anything referencing a row by id — a filing, a note — survives."""
    _rebuild(db_session, item, user)
    before = {row.plaid_tx_id: row.id for row in db_session.query(Transaction).all()}

    _rebuild(db_session, item, user)

    db_session.expire_all()
    after = {row.plaid_tx_id: row.id for row in db_session.query(Transaction).all()}
    assert after == before


def test_a_rebuild_does_not_touch_manual_transactions(
    db_session, user, account, item, plaid_history
):
    manual = Transaction(
        user_id=user.id, account_id=account.id, amount=Decimal("-15"),
        description="Cash lunch", transaction_date=date(2026, 8, 2),
    )
    db_session.add(manual)
    db_session.commit()
    manual_id = manual.id

    _rebuild(db_session, item, user)
    _rebuild(db_session, item, user)

    db_session.expire_all()
    survivor = db_session.query(Transaction).filter_by(id=manual_id).one()
    assert survivor.description == "Cash lunch"
    assert survivor.plaid_tx_id is None


def test_a_rebuild_re_establishes_the_cursor(db_session, user, account, item, plaid_history):
    _rebuild(db_session, item, user)

    db_session.expire_all()
    assert db_session.query(PlaidItem).filter_by(id=item.id).one().cursor == "cursor-after-rebuild"
    # And it started from nothing, which is what makes it a rebuild.
    assert plaid_history["cursors"][0] is None


def test_a_rebuild_refreshes_the_account_balance(db_session, user, account, item, plaid_history):
    _rebuild(db_session, item, user)

    db_session.expire_all()
    assert Decimal(str(db_session.query(Account).filter_by(id=account.id).one().balance)) == Decimal("900")


def test_one_failing_bank_does_not_block_another(db_session, user, account, item, monkeypatch):
    """Each Item is its own background task, so failure is per-connection."""
    healthy = PlaidItem(
        user_id=user.id,
        access_token=encrypt_secret("token-healthy"),
        item_id="item-healthy",
        institution_name="Healthy Bank",
    )
    db_session.add(healthy)
    db_session.commit()

    def fake_post(path, body):
        if path == "/accounts/get":
            return {"accounts": []}
        if path == "/transactions/sync":
            return {"added": [], "modified": [], "removed": [], "next_cursor": "c", "has_more": False}
        return {}

    def failing_for_first(path, body):
        raise RuntimeError("this bank is unreachable")

    monkeypatch.setattr(plaid_router, "_plaid_post", failing_for_first)
    with pytest.raises(RuntimeError):
        plaid_router._sync_item(db_session, item, user.id)
    db_session.rollback()

    monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)
    # The second bank still syncs, and records its own health.
    assert plaid_router._sync_item(db_session, healthy, user.id) == 0

    db_session.expire_all()
    assert db_session.query(PlaidItem).filter_by(id=healthy.id).one().cursor == "c"


def test_a_rebuild_never_crosses_tenants(db_session, user, other_user, account, item, plaid_history):
    """The imported rows belong to the requesting user and nobody else."""
    _rebuild(db_session, item, user)

    assert db_session.query(Transaction).filter_by(user_id=other_user.id).count() == 0
    assert db_session.query(Transaction).filter_by(user_id=user.id).count() == 2
