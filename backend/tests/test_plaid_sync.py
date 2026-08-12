"""Plaid sync ingestion: enrichment, idempotency and replacement behaviour.

`_sync_item` previously wrote transactions with a raw bulk insert that bypassed
`LedgerService`, so bank-imported rows never got a merchant key and never got a
category. These tests pin the unified behaviour *and* the invariants that
refactor had to preserve: exactly-once insertion, pending handling, and never
overwriting a category the user chose.

Plaid is stubbed at `_plaid_post`; no network access.
"""

from datetime import date
from decimal import Decimal

import pytest

from models.database import Account, Category, Transaction
from routers import plaid_router
from routers.plaid_router import PlaidItem
from services.transaction_enrichment import SOURCE_MERCHANT_HISTORY, SOURCE_USER
from utils.secret_box import encrypt_secret


PLAID_ACCOUNT_ID = "plaid-acct-1"


@pytest.fixture
def plaid_item(db_session, user, account):
    account.plaid_account_id = PLAID_ACCOUNT_ID
    item = PlaidItem(
        user_id=user.id,
        access_token=encrypt_secret("access-token"),
        item_id="item-1",
        institution_name="Test Bank",
    )
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)
    return item


def _accounts_payload():
    return {
        "accounts": [
            {
                "account_id": PLAID_ACCOUNT_ID,
                "name": "Primary Checking",
                "official_name": "Primary Checking",
                "subtype": "checking",
                "balances": {"current": 1000},
            }
        ]
    }


def _tx(transaction_id, **overrides):
    """A Plaid transaction with the enrichment fields sync now reads."""
    payload = {
        "transaction_id": transaction_id,
        "account_id": PLAID_ACCOUNT_ID,
        "amount": 15.99,  # Plaid positive = money out
        "date": "2026-03-02",
        "authorized_date": "2026-03-01",
        "name": "NETFLIX.COM 866-579-7172",
        "merchant_name": "Netflix",
        "merchant_entity_id": "ent_netflix",
        "payment_channel": "online",
        "transaction_code": "direct debit",
        "iso_currency_code": "USD",
        "personal_finance_category": {
            "primary": "ENTERTAINMENT",
            "detailed": "ENTERTAINMENT_STREAMING",
        },
        "pending": False,
    }
    payload.update(overrides)
    return payload


def _install_plaid_stub(monkeypatch, pages):
    """Stub `_plaid_post`, serving `/transactions/sync` pages in order."""
    remaining = list(pages)
    calls = []

    def fake_post(path, body):
        calls.append((path, body))
        if path == "/accounts/get":
            return _accounts_payload()
        if path == "/transactions/sync":
            page = remaining.pop(0) if remaining else {}
            return {
                "added": page.get("added", []),
                "modified": page.get("modified", []),
                "removed": page.get("removed", []),
                "next_cursor": page.get("next_cursor", "cursor-end"),
                "has_more": page.get("has_more", False),
            }
        raise AssertionError(f"unexpected Plaid call: {path}")

    monkeypatch.setattr(plaid_router, "_plaid_post", fake_post)
    return calls


def _sync(db_session, item, user, pages, monkeypatch):
    _install_plaid_stub(monkeypatch, pages)
    return plaid_router._sync_item(db_session, item, user.id)


# ─── Added ────────────────────────────────────────────────────────────────────
def test_added_transaction_is_stored_with_enrichment(
    db_session, user, account, plaid_item, monkeypatch
):
    added = _sync(db_session, plaid_item, user, [{"added": [_tx("tx-1")]}], monkeypatch)
    assert added == 1

    tx = db_session.query(Transaction).filter_by(plaid_tx_id="tx-1").one()
    # Sign is flipped: Plaid positive means money out.
    assert Decimal(str(tx.amount)) == Decimal("-15.99")
    assert tx.description == "Netflix"
    assert tx.transaction_date == date(2026, 3, 2)
    # Enrichment that used to be discarded entirely.
    assert tx.plaid_merchant_entity_id == "ent_netflix"
    assert tx.plaid_merchant_name == "Netflix"
    assert tx.original_description == "NETFLIX.COM 866-579-7172"
    assert tx.merchant_key == "netflix"
    assert tx.personal_finance_category_primary == "ENTERTAINMENT"
    assert tx.personal_finance_category_detailed == "ENTERTAINMENT_STREAMING"
    assert tx.payment_channel == "online"
    assert tx.transaction_code == "direct debit"
    assert tx.authorized_date == date(2026, 3, 1)
    assert tx.iso_currency_code == "USD"


def test_sync_is_idempotent_across_repeated_runs(
    db_session, user, account, plaid_item, monkeypatch
):
    """Replaying the same page must not duplicate rows."""
    first = _sync(db_session, plaid_item, user, [{"added": [_tx("tx-1")]}], monkeypatch)
    second = _sync(db_session, plaid_item, user, [{"added": [_tx("tx-1")]}], monkeypatch)

    assert first == 1
    assert second == 0
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-1").count() == 1


def test_duplicate_ids_within_one_page_insert_once(
    db_session, user, account, plaid_item, monkeypatch
):
    _sync(db_session, plaid_item, user, [{"added": [_tx("tx-1"), _tx("tx-1")]}], monkeypatch)
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-1").count() == 1


def test_pending_transactions_are_skipped(db_session, user, account, plaid_item, monkeypatch):
    added = _sync(
        db_session, plaid_item, user,
        [{"added": [_tx("tx-pending", pending=True)]}],
        monkeypatch,
    )
    assert added == 0
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-pending").count() == 0


def test_transactions_for_unmapped_accounts_are_skipped(
    db_session, user, account, plaid_item, monkeypatch
):
    added = _sync(
        db_session, plaid_item, user,
        [{"added": [_tx("tx-other", account_id="unknown-account")]}],
        monkeypatch,
    )
    assert added == 0


def test_multiple_pages_are_all_ingested(db_session, user, account, plaid_item, monkeypatch):
    added = _sync(
        db_session, plaid_item, user,
        [
            {"added": [_tx("tx-1")], "next_cursor": "cursor-1", "has_more": True},
            {"added": [_tx("tx-2")], "next_cursor": "cursor-2", "has_more": False},
        ],
        monkeypatch,
    )
    assert added == 2
    db_session.refresh(plaid_item)
    assert plaid_item.cursor == "cursor-2"


def test_cursor_is_sent_on_a_subsequent_sync(db_session, user, account, plaid_item, monkeypatch):
    calls = _install_plaid_stub(monkeypatch, [{"added": [], "next_cursor": "cursor-a"}])
    plaid_router._sync_item(db_session, plaid_item, user.id)

    calls2 = _install_plaid_stub(monkeypatch, [{"added": []}])
    plaid_router._sync_item(db_session, plaid_item, user.id)
    sync_bodies = [body for path, body in calls2 if path == "/transactions/sync"]
    assert sync_bodies[0]["cursor"] == "cursor-a"


# ─── Modified ─────────────────────────────────────────────────────────────────
def test_modified_updates_amount_and_metadata(
    db_session, user, account, plaid_item, monkeypatch
):
    _sync(db_session, plaid_item, user, [{"added": [_tx("tx-1")]}], monkeypatch)
    _sync(
        db_session, plaid_item, user,
        [{"modified": [_tx("tx-1", amount=17.99, payment_channel="in store")]}],
        monkeypatch,
    )

    db_session.expire_all()
    tx = db_session.query(Transaction).filter_by(plaid_tx_id="tx-1").one()
    assert Decimal(str(tx.amount)) == Decimal("-17.99")
    assert tx.payment_channel == "in store"


def test_modified_inserts_a_card_charge_that_settles_under_the_same_id(
    db_session, user, account, plaid_item, monkeypatch
):
    """The credit-card failure: pending → posted keeping one transaction_id.

    Card issuers settle a charge under the same id, flipping `pending` false
    and delivering the settle in `modified`. The pending form is skipped on
    ingest, so there is no row to modify. Before the fallback insert the charge
    was dropped by both branches and the cursor advanced past it, so the money
    never appeared and a re-sync could not recover it.
    """
    # Authorisation: arrives pending, correctly not stored.
    _sync(db_session, plaid_item, user, [{"added": [_tx("tx-card", pending=True)]}], monkeypatch)
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-card").count() == 0

    # Settlement: same id, now posted, delivered as a modification.
    added = _sync(
        db_session, plaid_item, user,
        [{"modified": [_tx("tx-card", pending=False, amount=15.99)]}],
        monkeypatch,
    )

    db_session.expire_all()
    assert added == 1
    tx = db_session.query(Transaction).filter_by(plaid_tx_id="tx-card").one()
    assert Decimal(str(tx.amount)) == Decimal("-15.99")
    assert tx.account_id == account.id
    assert tx.merchant_key == "netflix"  # enriched on the recovery path too


def test_modified_still_pending_is_not_inserted(
    db_session, user, account, plaid_item, monkeypatch
):
    """A revision that is still unsettled stays out of the ledger.

    Plaid re-delivers it on settle; inserting now would reintroduce exactly the
    duplicate-categorization problem that skipping pending charges solved.
    """
    added = _sync(
        db_session, plaid_item, user,
        [{"modified": [_tx("tx-card", pending=True)]}],
        monkeypatch,
    )
    assert added == 0
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-card").count() == 0


def test_modified_recovery_does_not_duplicate_on_replay(
    db_session, user, account, plaid_item, monkeypatch
):
    """Replaying the same settle twice inserts once — ON CONFLICT DO NOTHING."""
    _sync(db_session, plaid_item, user, [{"modified": [_tx("tx-card")]}], monkeypatch)
    added = _sync(db_session, plaid_item, user, [{"modified": [_tx("tx-card")]}], monkeypatch)

    db_session.expire_all()
    assert added == 0
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-card").count() == 1


def test_modified_for_an_unknown_account_is_skipped(
    db_session, user, account, plaid_item, monkeypatch
):
    """The recovery path must not invent a row with no account to hang it on."""
    added = _sync(
        db_session, plaid_item, user,
        [{"modified": [_tx("tx-card", account_id="plaid-acct-unknown")]}],
        monkeypatch,
    )
    assert added == 0
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-card").count() == 0


def test_modified_never_overwrites_a_user_chosen_category(
    db_session, user, account, category, plaid_item, monkeypatch
):
    """The invariant that matters most in this refactor."""
    _sync(db_session, plaid_item, user, [{"added": [_tx("tx-1")]}], monkeypatch)

    tx = db_session.query(Transaction).filter_by(plaid_tx_id="tx-1").one()
    tx.category_id = category.id
    tx.category_source = SOURCE_USER
    db_session.commit()

    # A later sync brings a PFC that maps elsewhere; the user's choice stands.
    entertainment = Category(user_id=user.id, name="Entertainment", type="expense")
    db_session.add(entertainment)
    db_session.commit()
    _sync(db_session, plaid_item, user, [{"modified": [_tx("tx-1", amount=19.99)]}], monkeypatch)

    db_session.expire_all()
    tx = db_session.query(Transaction).filter_by(plaid_tx_id="tx-1").one()
    assert tx.category_id == category.id
    assert tx.category_source == SOURCE_USER
    assert Decimal(str(tx.amount)) == Decimal("-19.99")  # other fields still update


def test_modified_fills_a_still_empty_category(
    db_session, user, account, plaid_item, monkeypatch
):
    _sync(db_session, plaid_item, user, [{"added": [_tx("tx-1")]}], monkeypatch)
    tx = db_session.query(Transaction).filter_by(plaid_tx_id="tx-1").one()
    assert tx.category_id is None

    entertainment = Category(user_id=user.id, name="Entertainment", type="expense")
    db_session.add(entertainment)
    db_session.commit()

    _sync(db_session, plaid_item, user, [{"modified": [_tx("tx-1")]}], monkeypatch)
    db_session.expire_all()
    tx = db_session.query(Transaction).filter_by(plaid_tx_id="tx-1").one()
    assert tx.category_id == entertainment.id


# ─── Removed ──────────────────────────────────────────────────────────────────
def test_removed_deletes_the_transaction(db_session, user, account, plaid_item, monkeypatch):
    _sync(db_session, plaid_item, user, [{"added": [_tx("tx-1")]}], monkeypatch)
    _sync(
        db_session, plaid_item, user,
        [{"removed": [{"transaction_id": "tx-1"}]}],
        monkeypatch,
    )
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-1").count() == 0


def test_removed_ignores_unknown_ids(db_session, user, account, plaid_item, monkeypatch):
    _sync(
        db_session, plaid_item, user,
        [{"removed": [{"transaction_id": "never-seen"}]}],
        monkeypatch,
    )  # must not raise


# ─── Pending → posted replacement ─────────────────────────────────────────────
def test_posted_replaces_a_stored_pending_row_and_keeps_its_category(
    db_session, user, account, category, plaid_item, monkeypatch
):
    # Simulate a pending row already in the ledger (imported before pending
    # charges were skipped) that the user has since categorized.
    pending = Transaction(
        user_id=user.id,
        account_id=account.id,
        category_id=category.id,
        category_source=SOURCE_USER,
        amount=Decimal("-15.99"),
        description="Netflix",
        plaid_tx_id="tx-pending",
        transaction_date=date(2026, 3, 1),
    )
    db_session.add(pending)
    db_session.commit()

    _sync(
        db_session, plaid_item, user,
        [{"added": [_tx("tx-posted", pending_transaction_id="tx-pending")]}],
        monkeypatch,
    )

    db_session.expire_all()
    # The pending row is now the posted one — same row, new Plaid id.
    assert db_session.query(Transaction).filter_by(plaid_tx_id="tx-pending").count() == 0
    posted = db_session.query(Transaction).filter_by(plaid_tx_id="tx-posted").one()
    assert posted.category_id == category.id
    assert posted.category_source == SOURCE_USER
    assert posted.merchant_key == "netflix"
    assert posted.plaid_merchant_entity_id == "ent_netflix"
    assert db_session.query(Transaction).filter_by(user_id=user.id).count() == 1


def test_replacement_does_not_duplicate_when_posted_row_already_exists(
    db_session, user, account, category, plaid_item, monkeypatch
):
    db_session.add_all([
        Transaction(
            user_id=user.id, account_id=account.id, category_id=category.id,
            category_source=SOURCE_USER, amount=Decimal("-15.99"), description="Netflix",
            plaid_tx_id="tx-pending", transaction_date=date(2026, 3, 1),
        ),
        Transaction(
            user_id=user.id, account_id=account.id, category_id=None,
            amount=Decimal("-15.99"), description="Netflix",
            plaid_tx_id="tx-posted", transaction_date=date(2026, 3, 2),
        ),
    ])
    db_session.commit()

    _sync(
        db_session, plaid_item, user,
        [{"added": [_tx("tx-posted", pending_transaction_id="tx-pending")]}],
        monkeypatch,
    )

    db_session.expire_all()
    assert db_session.query(Transaction).filter_by(user_id=user.id).count() == 1
    posted = db_session.query(Transaction).filter_by(plaid_tx_id="tx-posted").one()
    # The pending row's category is carried onto the surviving posted row.
    assert posted.category_id == category.id


# ─── Category suggestion on import ────────────────────────────────────────────
def test_import_suggests_a_category_from_the_users_own_history(
    db_session, user, account, category, plaid_item, monkeypatch
):
    """The gap this phase closes: Plaid rows used to always land uncategorized."""
    for day in (10, 11):
        db_session.add(
            Transaction(
                user_id=user.id,
                account_id=account.id,
                category_id=category.id,
                amount=Decimal("-15.99"),
                description="Netflix",
                merchant_key="netflix",
                plaid_merchant_entity_id="ent_netflix",
                transaction_date=date(2026, 2, day),
            )
        )
    db_session.commit()

    _sync(db_session, plaid_item, user, [{"added": [_tx("tx-new")]}], monkeypatch)

    tx = db_session.query(Transaction).filter_by(plaid_tx_id="tx-new").one()
    assert tx.category_id == category.id
    assert tx.category_source == SOURCE_MERCHANT_HISTORY


def test_import_stays_uncategorized_without_enough_signal(
    db_session, user, account, plaid_item, monkeypatch
):
    _sync(db_session, plaid_item, user, [{"added": [_tx("tx-1")]}], monkeypatch)
    tx = db_session.query(Transaction).filter_by(plaid_tx_id="tx-1").one()
    assert tx.category_id is None
    assert tx.category_source is None


def test_missing_optional_plaid_fields_are_tolerated(
    db_session, user, account, plaid_item, monkeypatch
):
    """A sparse payload — many institutions return no enrichment at all."""
    sparse = {
        "transaction_id": "tx-sparse",
        "account_id": PLAID_ACCOUNT_ID,
        "amount": 4.25,
        "date": "2026-03-02",
        "name": "CORNER SHOP",
        "pending": False,
    }
    added = _sync(db_session, plaid_item, user, [{"added": [sparse]}], monkeypatch)
    assert added == 1

    tx = db_session.query(Transaction).filter_by(plaid_tx_id="tx-sparse").one()
    assert tx.description == "CORNER SHOP"
    assert tx.merchant_key == "corner shop"
    assert tx.plaid_merchant_entity_id is None
    assert tx.authorized_date is None
    assert tx.personal_finance_category_primary is None


def test_malformed_authorized_date_does_not_break_import(
    db_session, user, account, plaid_item, monkeypatch
):
    added = _sync(
        db_session, plaid_item, user,
        [{"added": [_tx("tx-1", authorized_date="not-a-date")]}],
        monkeypatch,
    )
    assert added == 1
    tx = db_session.query(Transaction).filter_by(plaid_tx_id="tx-1").one()
    assert tx.authorized_date is None
