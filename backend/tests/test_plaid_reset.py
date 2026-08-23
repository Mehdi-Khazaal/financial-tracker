"""Characterization of `POST /plaid/reset` — "Reset & Start Fresh".

This is the most destructive endpoint in the application and had no coverage at
all. These tests deliberately pin **current** behaviour rather than desired
behaviour, so that Phase 6C can change it against a baseline that says out loud
what it used to do.

Two of them documented defects rather than guarantees. 6C-6 fixed one and
inverted its test in place:

  * `test_a_failed_remote_removal_still_drops_the_local_row_CURRENT_BEHAVIOUR`
    became `test_a_failed_remote_removal_stops_the_whole_reset`.

The other is still pinned, deliberately:

  * `test_account_balances_are_left_stale_CURRENT_BEHAVIOUR` — see its
    docstring for why the arithmetic to fix it does not exist yet.

Do not "fix" a failure here by loosening the assertion. If one of these starts
failing, the endpoint's behaviour changed, and that is the finding.
"""

from datetime import date
from decimal import Decimal

import pytest

from models.auth import User
from models.database import Account, Category, RecurringTransaction, Transaction
from routers import plaid_router
from routers.plaid_router import PlaidItem
from utils import auth as auth_utils
from utils.secret_box import encrypt_secret


PLAID_ACCOUNT_ID = "plaid-acct-reset"


@pytest.fixture
def item(db_session, user, account):
    account.plaid_account_id = PLAID_ACCOUNT_ID
    row = PlaidItem(
        user_id=user.id,
        access_token=encrypt_secret("access-token"),
        item_id="item-reset-1",
        institution_name="Test Bank",
        cursor="cursor-abc",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


@pytest.fixture
def other_user(db_session):
    row = User(
        email="other@example.com",
        username="other1",
        hashed_password=auth_utils.get_password_hash("Password123"),
        is_verified=True,
        is_admin=False,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


@pytest.fixture
def stub_plaid(monkeypatch):
    """Record Plaid calls; `/item/remove` succeeds unless a test says otherwise."""
    calls = []

    def fake_post(path, body):
        calls.append(path)
        return {}

    monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)
    return calls


def _tx(db_session, user_id, account_id, amount, plaid_tx_id=None, category_id=None):
    row = Transaction(
        user_id=user_id,
        account_id=account_id,
        category_id=category_id,
        amount=Decimal(str(amount)),
        description="Entry",
        plaid_tx_id=plaid_tx_id,
        transaction_date=date(2026, 8, 1),
    )
    db_session.add(row)
    db_session.commit()
    return row


# --- What it deletes ---------------------------------------------------------
def test_reset_requires_authentication(client):
    assert client.post("/plaid/reset").status_code == 401


def test_imported_transactions_are_deleted(
    client, auth_headers, db_session, user, account, item, stub_plaid
):
    _tx(db_session, user.id, account.id, -50, plaid_tx_id="tx-imported-1")
    _tx(db_session, user.id, account.id, -60, plaid_tx_id="tx-imported-2")

    response = client.post("/plaid/reset", headers=auth_headers)
    assert response.status_code == 200

    remaining = db_session.query(Transaction).filter(
        Transaction.plaid_tx_id.isnot(None)
    ).count()
    assert remaining == 0


def test_manual_transactions_survive(
    client, auth_headers, db_session, user, account, item, stub_plaid
):
    """The confirm copy promises this, so it is a contract, not an accident."""
    manual = _tx(db_session, user.id, account.id, -25)
    _tx(db_session, user.id, account.id, -50, plaid_tx_id="tx-imported-1")

    client.post("/plaid/reset", headers=auth_headers)

    db_session.expire_all()
    assert db_session.query(Transaction).filter_by(id=manual.id).one_or_none() is not None


def test_plaid_items_are_removed(client, auth_headers, db_session, user, item, stub_plaid):
    client.post("/plaid/reset", headers=auth_headers)
    assert db_session.query(PlaidItem).filter_by(user_id=user.id).count() == 0


def test_the_remote_item_is_removed_at_plaid(client, auth_headers, item, stub_plaid):
    client.post("/plaid/reset", headers=auth_headers)
    assert "/item/remove" in stub_plaid


def test_the_response_counts_what_it_removed(
    client, auth_headers, db_session, user, account, item, stub_plaid
):
    _tx(db_session, user.id, account.id, -50, plaid_tx_id="tx-imported-1")
    body = client.post("/plaid/reset", headers=auth_headers).json()
    assert "1" in body["message"]


# --- Tenant isolation --------------------------------------------------------
def test_another_users_transactions_are_untouched(
    client, auth_headers, db_session, user, account, other_user, item, stub_plaid
):
    theirs = Account(
        user_id=other_user.id, name="Theirs", type="checking",
        balance=Decimal("100"), currency="USD",
    )
    db_session.add(theirs)
    db_session.commit()
    their_tx = _tx(db_session, other_user.id, theirs.id, -70, plaid_tx_id="tx-theirs")

    client.post("/plaid/reset", headers=auth_headers)

    db_session.expire_all()
    assert db_session.query(Transaction).filter_by(id=their_tx.id).one_or_none() is not None


def test_another_users_items_are_untouched(
    client, auth_headers, db_session, other_user, item, stub_plaid
):
    theirs = PlaidItem(
        user_id=other_user.id,
        access_token=encrypt_secret("their-token"),
        item_id="item-theirs",
        institution_name="Their Bank",
    )
    db_session.add(theirs)
    db_session.commit()

    client.post("/plaid/reset", headers=auth_headers)

    db_session.expire_all()
    assert db_session.query(PlaidItem).filter_by(user_id=other_user.id).count() == 1


# --- What it preserves -------------------------------------------------------
def test_categories_are_preserved(
    client, auth_headers, db_session, user, category, item, stub_plaid
):
    client.post("/plaid/reset", headers=auth_headers)
    db_session.expire_all()
    assert db_session.query(Category).filter_by(id=category.id).one_or_none() is not None


def test_declared_recurring_records_are_preserved(
    client, auth_headers, db_session, user, account, item, stub_plaid
):
    recurring = RecurringTransaction(
        user_id=user.id, account_id=account.id, amount=Decimal("-9.99"),
        description="Netflix", period="monthly", next_date=date(2026, 9, 1),
    )
    db_session.add(recurring)
    db_session.commit()

    client.post("/plaid/reset", headers=auth_headers)

    db_session.expire_all()
    assert db_session.query(RecurringTransaction).filter_by(id=recurring.id).one_or_none() is not None


def test_account_rows_are_not_deleted(
    client, auth_headers, db_session, user, account, item, stub_plaid
):
    """Accounts outlive the connection, keeping their Plaid id.

    On reconnect `exchange_token` re-adopts them by `plaid_account_id` or by
    name, which is why this does not produce duplicate accounts. It does mean a
    disconnected account keeps pointing at an Item that no longer exists.
    """
    client.post("/plaid/reset", headers=auth_headers)

    db_session.expire_all()
    surviving = db_session.query(Account).filter_by(id=account.id).one()
    assert surviving.plaid_account_id == PLAID_ACCOUNT_ID


# --- Defects, pinned deliberately --------------------------------------------
def test_account_balances_are_left_stale_CURRENT_BEHAVIOUR(
    client, auth_headers, db_session, user, account, item, stub_plaid
):
    """DEFECT, still pinned after the 6C-6 balance audit. Do not delete it.

    Reset deletes imported rows in bulk, bypassing `LedgerService`, and removes
    every Item in the same call, so nothing re-reads balances from Plaid
    afterwards.

    6C-6 audited whether a correct post-reset balance can be *derived* from
    stored data, and it cannot:

    * `Account.balance` is an absolute figure, not a running total of rows we
      hold. `_sync_item` **overwrites** it from `/accounts/get`; manual entries
      adjust it by delta via `LedgerService._adjust_balance`. Both authorities
      write the same column.
    * The imported window is `PLAID_DAYS_REQUESTED`, not the account's whole
      life, so summing the surviving transactions is not the balance and never
      was.
    * `Account` has no opening-balance or baseline column, and
      `account_balance_snapshots` cannot stand in for one: every snapshot is
      recomputed as `current balance − sum(later transactions)`, so it inherits
      the same anchor rather than recording an independent past value.

    Zeroing it, summing the remainder, or deleting the account would each
    invent a number or destroy manual data. Inverting this test requires an
    `opening_balance` + `baseline_date` on `accounts`, not a change here.
    """
    starting_balance = Decimal(str(account.balance))
    _tx(db_session, user.id, account.id, -50, plaid_tx_id="tx-imported-1")

    client.post("/plaid/reset", headers=auth_headers)

    db_session.expire_all()
    after = db_session.query(Account).filter_by(id=account.id).one()
    assert Decimal(str(after.balance)) == starting_balance, (
        "Balance changed — the stale-balance defect may have been fixed. "
        "If so, invert this test rather than relaxing it."
    )


def test_a_failed_remote_removal_stops_the_whole_reset(
    client, auth_headers, db_session, user, account, item, monkeypatch
):
    """INVERTED in 6C-6. Was `..._still_drops_the_local_row_CURRENT_BEHAVIOUR`.

    The failure used to be swallowed: the local row went regardless, so an Item
    Plaid still considered live became invisible to Fintrack — able to keep
    sending webhooks and billing, with nothing left to reconcile it against.

    Now the remote phase runs first and gates everything, so a failure leaves
    the user exactly where they started.
    """
    _tx(db_session, user.id, account.id, -50, plaid_tx_id="tx-imported-1")

    def failing_post(path, body):
        raise RuntimeError("plaid unreachable")

    monkeypatch.setattr(plaid_router, "_plaid_post", failing_post)

    response = client.post("/plaid/reset", headers=auth_headers)

    assert response.status_code == 502
    assert "nothing" in response.json()["detail"].lower()

    db_session.expire_all()
    assert db_session.query(PlaidItem).filter_by(user_id=user.id).count() == 1
    # And — the claim the message makes — the history really is still there.
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-imported-1").one_or_none() is not None


def test_categorization_work_on_imported_rows_is_lost_CURRENT_BEHAVIOUR(
    client, auth_headers, db_session, user, account, category, item, stub_plaid
):
    """Pinned so the confirmation copy can be held to it.

    A categorized bank transaction is deleted outright, so the filing work is
    gone. It also removes the row from `_history_vote`'s evidence, which is how
    learned merchant categorization quietly degrades after a reset.
    """
    _tx(db_session, user.id, account.id, -50, plaid_tx_id="tx-filed", category_id=category.id)

    client.post("/plaid/reset", headers=auth_headers)

    db_session.expire_all()
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-filed").one_or_none() is None
    # The category itself survives; only the filing evidence is destroyed.
    assert db_session.query(Category).filter_by(id=category.id).one_or_none() is not None

# --- The two-phase design (6C-6) ---------------------------------------------
# A remote API cannot be rolled back, so partial failure is handled by never
# starting the destructive half. Everything below exists to keep that ordering
# honest: the message promises nothing was deleted, and these prove it.


@pytest.fixture
def second_item(db_session, user):
    row = PlaidItem(
        user_id=user.id,
        access_token=encrypt_secret("access-token-2"),
        item_id="item-reset-2",
        institution_name="PNC",
        cursor="cursor-def",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def test_the_remote_removal_happens_before_anything_is_deleted(
    client, auth_headers, db_session, user, account, item, stub_plaid, monkeypatch
):
    """Ordering, observed from inside the request's own session.

    It has to be that session: a staged delete is invisible to every other
    connection until it commits, so asking the test's session would pass
    whatever the endpoint did. `_item_access_token` is the hook, because it is
    handed the request session immediately before the remote call.

    The explicit `flush()` matters as much as the session does. The test
    sessions are built with `autoflush=False`, so a pending delete would not
    reach the database before the count and the assertion would hold even for a
    delete-first implementation. Flushing forces any staged deletion to show.
    """
    seen = {}
    real_token = plaid_router._item_access_token

    def observing_token(db, item):
        db.flush()
        seen["history_at_remote_call"] = (
            db.query(Transaction)
            .filter(Transaction.plaid_tx_id == "tx-imported-1")
            .count()
        )
        return real_token(db, item)

    _tx(db_session, user.id, account.id, -50, plaid_tx_id="tx-imported-1")
    monkeypatch.setattr(plaid_router, "_item_access_token", observing_token)

    assert client.post("/plaid/reset", headers=auth_headers).status_code == 200
    assert seen["history_at_remote_call"] == 1, "history was deleted before Plaid was asked"


def test_one_failing_bank_of_two_stops_everything(
    client, auth_headers, db_session, user, account, item, second_item, monkeypatch
):
    """Capital One succeeds, PNC fails. Nothing local may be touched."""
    def post(path, body):
        # The second Item's token is the one that fails.
        from utils.secret_box import decrypt_secret
        if decrypt_secret(second_item.access_token) == body.get("access_token"):
            raise RuntimeError("plaid unreachable")
        return {}

    _tx(db_session, user.id, account.id, -50, plaid_tx_id="tx-imported-1")
    monkeypatch.setattr(plaid_router, "_plaid_post", post)

    response = client.post("/plaid/reset", headers=auth_headers)

    assert response.status_code == 502
    # Named, so the user knows which connection to deal with.
    assert "PNC" in response.json()["detail"]

    db_session.expire_all()
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-imported-1").one_or_none() is not None
    # Both rows survive — including the one already removed at Plaid, which is
    # what lets the retry resolve it via ITEM_NOT_FOUND.
    assert db_session.query(PlaidItem).filter_by(user_id=user.id).count() == 2


def test_a_retry_after_a_partial_failure_completes(
    client, auth_headers, db_session, user, account, item, second_item, monkeypatch
):
    """The recovery the design depends on, run end to end."""
    from utils.secret_box import decrypt_secret

    state = {"pnc_reachable": False, "capital_one_removed": False}

    def post(path, body):
        token = body.get("access_token")
        if decrypt_secret(second_item.access_token) == token:
            if not state["pnc_reachable"]:
                raise RuntimeError("plaid unreachable")
            return {}
        # Capital One: gone after the first attempt, so the retry sees the
        # terminal error rather than a second successful removal.
        if state["capital_one_removed"]:
            raise plaid_router.PlaidItemNotFound()
        state["capital_one_removed"] = True
        return {}

    _tx(db_session, user.id, account.id, -50, plaid_tx_id="tx-imported-1")
    monkeypatch.setattr(plaid_router, "_plaid_post", post)

    assert client.post("/plaid/reset", headers=auth_headers).status_code == 502

    state["pnc_reachable"] = True
    assert client.post("/plaid/reset", headers=auth_headers).status_code == 200

    db_session.expire_all()
    assert db_session.query(PlaidItem).filter_by(user_id=user.id).count() == 0
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-imported-1").one_or_none() is None


def test_an_already_removed_item_does_not_block_a_reset(
    client, auth_headers, db_session, user, item, monkeypatch
):
    """ITEM_NOT_FOUND is terminal proof, not a failure."""
    def already_gone(path, body):
        raise plaid_router.PlaidItemNotFound()

    monkeypatch.setattr(plaid_router, "_plaid_post", already_gone)

    assert client.post("/plaid/reset", headers=auth_headers).status_code == 200
    db_session.expire_all()
    assert db_session.query(PlaidItem).filter_by(user_id=user.id).count() == 0


def test_a_local_failure_rolls_the_whole_reset_back(
    client, auth_headers, db_session, user, account, item, stub_plaid, monkeypatch
):
    """History and connections fall together, or not at all."""
    _tx(db_session, user.id, account.id, -50, plaid_tx_id="tx-imported-1")

    def boom(self):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(plaid_router.Session, "commit", boom)

    response = client.post("/plaid/reset", headers=auth_headers)
    assert response.status_code == 500
    assert "could not finish" in response.json()["detail"].lower()

    monkeypatch.undo()
    db_session.expire_all()
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-imported-1").one_or_none() is not None
    assert db_session.query(PlaidItem).filter_by(user_id=user.id).count() == 1


def test_a_failed_reset_leaks_nothing(
    client, auth_headers, db_session, user, item, monkeypatch
):
    def failing_post(path, body):
        raise RuntimeError("plaid unreachable")

    monkeypatch.setattr(plaid_router, "_plaid_post", failing_post)

    body = client.post("/plaid/reset", headers=auth_headers).text
    assert "access-token" not in body
    assert "cursor-abc" not in body
    assert "item-reset-1" not in body


def test_a_reset_with_no_banks_still_clears_imported_history(
    client, auth_headers, db_session, user, account, stub_plaid
):
    """A leftover import with no Item behind it is still Plaid data."""
    _tx(db_session, user.id, account.id, -50, plaid_tx_id="tx-orphaned")

    assert client.post("/plaid/reset", headers=auth_headers).status_code == 200

    db_session.expire_all()
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-orphaned").one_or_none() is None
    assert stub_plaid == []
