"""Category types, including the `investment` third type.

The frontend gained an `investment` category type so a purchase that bought
something the user still holds is kept out of spending. The backend was assumed
to need no change because `CategoryUpdate.type` is a bare `str` — but
`CategoryBase.type` was `Literal["income", "expense"]`, so creating one returned
422 and the feature was unusable in production.

`CategoryResponse` extends `CategoryBase`, so the round-trip matters as much as
the write: a type accepted on POST but missing from the response model would
make the stored row unserializable and break `GET /categories` for the whole
account. Every test here therefore reads back what it wrote.
"""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import text

from models.database import (
    Category,
    MerchantCanonical,
    RecurringTransaction,
    Transaction,
)


CATEGORY_TYPES = ["expense", "income", "investment"]


@pytest.mark.parametrize("category_type", CATEGORY_TYPES)
def test_category_of_each_type_can_be_created_and_read_back(
    client, auth_headers, category_type
):
    created = client.post(
        "/categories",
        json={"name": f"Test {category_type}", "type": category_type, "color": "#f97316"},
        headers=auth_headers,
        follow_redirects=True,
    )
    assert created.status_code == 201, created.text
    assert created.json()["type"] == category_type

    listed = client.get("/categories", headers=auth_headers, follow_redirects=True)
    assert listed.status_code == 200
    assert any(
        c["id"] == created.json()["id"] and c["type"] == category_type
        for c in listed.json()
    )


def test_an_unknown_category_type_is_still_rejected(client, auth_headers):
    response = client.post(
        "/categories",
        json={"name": "Nonsense", "type": "wealth", "color": "#f97316"},
        headers=auth_headers,
        follow_redirects=True,
    )
    assert response.status_code == 422


def test_a_category_can_be_retyped_as_investment(client, auth_headers, db_session, user):
    created = client.post(
        "/categories",
        json={"name": "Gold", "type": "expense", "color": "#f97316"},
        headers=auth_headers,
        follow_redirects=True,
    )
    category_id = created.json()["id"]

    updated = client.put(
        f"/categories/{category_id}",
        json={"type": "investment"},
        headers=auth_headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["type"] == "investment"

    db_session.expire_all()
    assert db_session.query(Category).filter_by(id=category_id).one().type == "investment"


def test_update_still_rejects_an_unknown_type(client, auth_headers):
    created = client.post(
        "/categories",
        json={"name": "Groceries", "type": "expense", "color": "#f97316"},
        headers=auth_headers,
        follow_redirects=True,
    )
    response = client.put(
        f"/categories/{created.json()['id']}",
        json={"type": "wealth"},
        headers=auth_headers,
    )
    assert response.status_code == 422


# --- System categories are immutable -----------------------------------------
# Enforced by `_reject_if_system`, not by the owner filter. Defaults are seeded
# per user with a real `user_id`, so before Phase 6B both endpoints matched them
# and mutated them happily — the "immutable" contract existed only in the UI.
# 403, not 404: the row exists and the caller can see it in the listing.


@pytest.fixture
def other_owner(db_session):
    """A category belonging to somebody else."""
    from models.auth import User
    from utils import auth as auth_utils

    stranger = User(
        email="stranger@example.com",
        username="stranger1",
        hashed_password=auth_utils.get_password_hash("Password123"),
        is_verified=True,
        is_admin=False,
    )
    db_session.add(stranger)
    db_session.commit()
    row = Category(user_id=stranger.id, name="Theirs", type="expense", color="#5b8fff")
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


@pytest.fixture
def system_category(db_session, user):
    """A default category in the shape `seed_user_categories` actually writes.

    Owned by the user, flagged `is_system`. Phase 6.0 built this fixture with
    `user_id=None` and concluded from it that defaults were immutable; nothing
    in the app ever writes an owner-less category, so those tests passed while
    describing a row that does not exist. The owner filter matches a default,
    which is why immutability needs an explicit guard.
    """
    row = Category(user_id=user.id, name="Groceries", type="expense", color="#5b8fff", is_system=True)
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def test_a_system_category_is_listed(client, auth_headers, system_category):
    listed = client.get("/categories", headers=auth_headers, follow_redirects=True).json()
    assert any(c["id"] == system_category.id for c in listed)


def test_a_system_category_cannot_be_updated(client, auth_headers, system_category, db_session):
    response = client.put(
        f"/categories/{system_category.id}",
        json={"name": "Renamed"},
        headers=auth_headers,
    )
    assert response.status_code == 403
    db_session.expire_all()
    assert db_session.query(Category).filter_by(id=system_category.id).one().name == "Groceries"


def test_a_system_category_cannot_be_deleted(client, auth_headers, system_category, db_session):
    response = client.delete(f"/categories/{system_category.id}", headers=auth_headers)
    assert response.status_code == 403
    db_session.expire_all()
    assert db_session.query(Category).filter_by(id=system_category.id).one_or_none() is not None


def test_a_user_category_can_be_updated(client, auth_headers, category, db_session):
    response = client.put(
        f"/categories/{category.id}", json={"name": "Renamed"}, headers=auth_headers
    )
    assert response.status_code == 200
    db_session.expire_all()
    assert db_session.query(Category).filter_by(id=category.id).one().name == "Renamed"


def test_a_user_category_can_be_deleted(client, auth_headers, category, db_session):
    # Read the id before the row goes away: expiring a deleted instance and
    # then touching an attribute raises ObjectDeletedError rather than None.
    category_id = category.id
    assert client.delete(f"/categories/{category_id}", headers=auth_headers).status_code == 204
    db_session.expire_all()
    assert db_session.query(Category).filter_by(id=category_id).one_or_none() is None


# --- Tenant isolation --------------------------------------------------------
def test_another_users_category_cannot_be_updated(client, auth_headers, db_session, other_owner):
    response = client.put(
        f"/categories/{other_owner.id}", json={"name": "Hijacked"}, headers=auth_headers
    )
    assert response.status_code == 404
    db_session.expire_all()
    assert db_session.query(Category).filter_by(id=other_owner.id).one().name == "Theirs"


def test_another_users_category_cannot_be_deleted(client, auth_headers, db_session, other_owner):
    assert client.delete(f"/categories/{other_owner.id}", headers=auth_headers).status_code == 404
    db_session.expire_all()
    assert db_session.query(Category).filter_by(id=other_owner.id).one_or_none() is not None


# --- Deletion blast radius ---------------------------------------------------
# `Transaction.category_id` and `RecurringTransaction.category_id` are both
# declared `ondelete="SET NULL"`. Two different mechanisms deliver that, and
# only one of them covers both tables:
#
#   * `Category.transactions` is a mapped relationship, so SQLAlchemy nulls
#     those rows itself on delete, database enforcement or not.
#   * `RecurringTransaction` has **no** such relationship, so its rows are
#     nulled only by the database honouring the constraint.
#
# SQLite ships with foreign keys disabled, so the recurring test would pass
# while proving nothing unless enforcement is turned on for its connection.
# Postgres always enforces, so production is covered either way.


def _enforce_foreign_keys(db_session):
    db_session.execute(text("PRAGMA foreign_keys=ON"))


def test_deleting_a_category_nulls_it_on_transactions(
    client, auth_headers, db_session, user, account, category
):
    _enforce_foreign_keys(db_session)
    tx = Transaction(
        user_id=user.id, account_id=account.id, category_id=category.id,
        amount=Decimal("-20"), description="Filed", transaction_date=date(2026, 8, 1),
    )
    db_session.add(tx)
    db_session.commit()

    assert client.delete(f"/categories/{category.id}", headers=auth_headers).status_code == 204

    db_session.expire_all()
    surviving = db_session.query(Transaction).filter_by(id=tx.id).one()
    assert surviving.category_id is None, "The transaction must survive, uncategorized"


def test_deleting_a_category_nulls_it_on_recurring_records(
    client, auth_headers, db_session, user, account, category
):
    """Not mentioned in the confirmation copy, which only warns about transactions."""
    _enforce_foreign_keys(db_session)
    recurring = RecurringTransaction(
        user_id=user.id, account_id=account.id, category_id=category.id,
        amount=Decimal("-9.99"), description="Netflix",
        period="monthly", next_date=date(2026, 9, 1),
    )
    db_session.add(recurring)
    db_session.commit()

    assert client.delete(f"/categories/{category.id}", headers=auth_headers).status_code == 204

    db_session.expire_all()
    surviving = db_session.query(RecurringTransaction).filter_by(id=recurring.id).one()
    assert surviving.category_id is None


# --- Name uniqueness ---------------------------------------------------------
# One name per type per user, compared case-insensitively after trimming.
# Scoped to the type so an expense "Other" and an income "Other" can coexist.


def _create(client, headers, name, type_="expense", color="#f97316"):
    return client.post(
        "/categories",
        json={"name": name, "type": type_, "color": color},
        headers=headers,
        follow_redirects=True,
    )


def test_an_exact_duplicate_is_rejected(client, auth_headers):
    assert _create(client, auth_headers, "Groceries").status_code == 201
    duplicate = _create(client, auth_headers, "Groceries")
    assert duplicate.status_code == 409
    assert "already have" in duplicate.json()["detail"]


def test_a_case_variant_is_a_duplicate(client, auth_headers):
    """`_pfc_category` matches category names case-insensitively.

    Two casings coexisting meant the auto-categorizer's `.first()` chose between
    them arbitrarily, which is why this is a duplicate rather than a nicety.
    """
    assert _create(client, auth_headers, "groceries").status_code == 201
    assert _create(client, auth_headers, "GROCERIES").status_code == 409


def test_surrounding_whitespace_is_a_duplicate(client, auth_headers):
    assert _create(client, auth_headers, "Groceries").status_code == 201
    assert _create(client, auth_headers, "  groceries  ").status_code == 409


def test_the_stored_name_is_trimmed(client, auth_headers):
    created = _create(client, auth_headers, "  Gold Bars  ")
    assert created.status_code == 201
    assert created.json()["name"] == "Gold Bars"


def test_the_same_name_is_allowed_under_a_different_type(client, auth_headers):
    assert _create(client, auth_headers, "Other", "expense").status_code == 201
    assert _create(client, auth_headers, "Other", "income").status_code == 201
    assert _create(client, auth_headers, "Other", "investment").status_code == 201


def test_a_default_category_name_is_taken_too(client, auth_headers, system_category):
    """Defaults occupy the namespace: they are the user's rows, not globals."""
    assert _create(client, auth_headers, "Groceries").status_code == 409


def test_another_users_name_does_not_collide(client, auth_headers, other_owner):
    """`other_owner` already holds an expense category called "Theirs"."""
    assert _create(client, auth_headers, "Theirs").status_code == 201


def test_renaming_onto_another_category_is_rejected(client, auth_headers):
    _create(client, auth_headers, "Groceries")
    target = _create(client, auth_headers, "Petrol").json()

    response = client.put(
        f"/categories/{target['id']}", json={"name": "groceries"}, headers=auth_headers
    )
    assert response.status_code == 409


def test_renaming_a_category_to_its_own_name_is_fine(client, auth_headers):
    """Re-saving without changing the name must not collide with itself."""
    created = _create(client, auth_headers, "Petrol").json()
    response = client.put(
        f"/categories/{created['id']}",
        json={"name": "Petrol", "color": "#10b981"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["color"] == "#10b981"


def test_changing_only_the_case_of_a_name_is_allowed(client, auth_headers):
    created = _create(client, auth_headers, "petrol").json()
    response = client.put(
        f"/categories/{created['id']}", json={"name": "Petrol"}, headers=auth_headers
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Petrol"


# --- Colour validation -------------------------------------------------------
# Validated by shape, not against a palette: the eighteen seeded defaults use
# six colours and the frontend offers ten presets, with *no overlap at all*, so
# an allowlist would reject every default the moment one was touched.


@pytest.mark.parametrize("color", ["nonsense", "#12345", "#1234567", "red", "", "#hhhhhh"])
def test_an_invalid_colour_is_rejected(client, auth_headers, color):
    assert _create(client, auth_headers, "Odd", color=color).status_code == 422


@pytest.mark.parametrize("color", ["#5b8fff", "#F59E0B", "#ff5f6d"])
def test_a_hex_colour_is_accepted(client, auth_headers, color):
    """Includes a seeded default's colour, which no palette allowlist contains."""
    response = _create(client, auth_headers, f"Cat {color}", color=color)
    assert response.status_code == 201
    assert response.json()["color"] == color.lower()


def test_an_invalid_colour_is_rejected_on_update(client, auth_headers, category):
    response = client.put(
        f"/categories/{category.id}", json={"color": "nonsense"}, headers=auth_headers
    )
    assert response.status_code == 422


# --- Ordering ----------------------------------------------------------------
# Defaults first, then the user's own, alphabetically and case-insensitively
# within each group.


def test_defaults_sort_before_custom_categories(client, auth_headers, system_category):
    _create(client, auth_headers, "aardvark")
    _create(client, auth_headers, "Zebra")

    listed = client.get("/categories", headers=auth_headers, follow_redirects=True).json()
    expense = [c for c in listed if c["type"] == "expense"]
    assert expense[0]["name"] == "Groceries", "the default comes first"
    assert [c["name"] for c in expense[1:]] == ["aardvark", "Zebra"], "then custom, case-insensitively"


# --- Auto-categorization safety ----------------------------------------------
# Three columns reference a category, and all three are ON DELETE SET NULL:
# `Transaction.category_id`, `RecurringTransaction.category_id`, and
# `MerchantCanonical.default_category_id`. Deleting a category therefore leaves
# no dangling id anywhere, and the rows that referenced it degrade to
# uncategorized rather than being reassigned to something else.


def test_deleting_a_category_nulls_the_global_merchant_default(
    client, auth_headers, db_session, category
):
    """`merchants_canonical` is global, but its default points at a user's row.

    Nothing reads this value when categorizing — `transaction_enrichment` votes
    strictly inside the current user's own history, precisely so one account's
    filing cannot leak into another's. It is descriptive metadata refreshed by a
    nightly cron. It still must not be left pointing at a deleted id.
    """
    _enforce_foreign_keys(db_session)
    merchant = MerchantCanonical(name="netflix", default_category_id=category.id)
    db_session.add(merchant)
    db_session.commit()
    merchant_id = merchant.id
    category_id = category.id

    assert client.delete(f"/categories/{category_id}", headers=auth_headers).status_code == 204

    db_session.expire_all()
    surviving = db_session.query(MerchantCanonical).filter_by(id=merchant_id).one()
    assert surviving.default_category_id is None


def test_a_deleted_category_stops_being_an_auto_categorization_target(
    client, auth_headers, db_session, user, account, category
):
    """History voting reads `Transaction.category_id`, so the evidence goes too.

    `_history_vote` counts a user's prior categorized transactions for a
    merchant. Once deletion nulls those, the deleted category has no votes and
    cannot be suggested again — which is the desired failure mode, since the
    alternative is suggesting a category that no longer exists.
    """
    _enforce_foreign_keys(db_session)
    for index in range(3):
        db_session.add(Transaction(
            user_id=user.id, account_id=account.id, category_id=category.id,
            amount=Decimal("-12"), description="NETFLIX.COM",
            merchant_key="netflix", transaction_date=date(2026, 8, index + 1),
        ))
    db_session.commit()
    category_id = category.id

    from services.transaction_enrichment import resolve_transaction_merchant, suggest_transaction_category

    identity = resolve_transaction_merchant("NETFLIX.COM")
    before, _ = suggest_transaction_category(db_session, user.id, identity)
    assert before == category_id, "the history vote should find it while it exists"

    assert client.delete(f"/categories/{category_id}", headers=auth_headers).status_code == 204
    db_session.expire_all()

    after, source = suggest_transaction_category(db_session, user.id, identity)
    assert after is None, "a deleted category must never be suggested"
    assert source is None


def test_renaming_a_category_keeps_its_transactions(
    client, auth_headers, db_session, user, account, category
):
    """Rename is an update, not a replace: the id is the identity."""
    tx = Transaction(
        user_id=user.id, account_id=account.id, category_id=category.id,
        amount=Decimal("-30"), description="Filed", transaction_date=date(2026, 8, 1),
    )
    db_session.add(tx)
    db_session.commit()
    tx_id, category_id = tx.id, category.id

    response = client.put(
        f"/categories/{category_id}", json={"name": "Renamed"}, headers=auth_headers
    )
    assert response.status_code == 200

    db_session.expire_all()
    assert db_session.query(Transaction).filter_by(id=tx_id).one().category_id == category_id


def test_renaming_away_from_a_plaid_name_changes_future_mapping(
    client, auth_headers, db_session, user
):
    """A consequence worth knowing about, pinned rather than prevented.

    `PFC_TO_CATEGORY_NAME` maps Plaid's taxonomy onto the user's categories *by
    name*, matched case-insensitively. So renaming "Entertainment" to something
    else silently stops Plaid ENTERTAINMENT transactions mapping to it. Past
    transactions are unaffected — they already hold a `category_id` — but future
    imports lose the mapping.

    Not treated as an error: the user is entitled to name their categories, and
    the alternative is refusing renames to protect a lookup table.
    """
    from services.transaction_enrichment import _pfc_category

    entertainment = Category(
        user_id=user.id, name="Entertainment", type="expense", color="#a78bfa"
    )
    db_session.add(entertainment)
    db_session.commit()
    category_id = entertainment.id

    assert _pfc_category(db_session, user.id, "ENTERTAINMENT") == category_id

    assert client.put(
        f"/categories/{category_id}", json={"name": "Fun Money"}, headers=auth_headers
    ).status_code == 200
    db_session.expire_all()

    assert _pfc_category(db_session, user.id, "ENTERTAINMENT") is None


def test_a_renamed_category_is_still_matched_case_insensitively_by_plaid(
    client, auth_headers, db_session, user
):
    """The flip side: casing alone does not break the PFC mapping."""
    from services.transaction_enrichment import _pfc_category

    entertainment = Category(
        user_id=user.id, name="Entertainment", type="expense", color="#a78bfa"
    )
    db_session.add(entertainment)
    db_session.commit()
    category_id = entertainment.id

    assert client.put(
        f"/categories/{category_id}", json={"name": "ENTERTAINMENT"}, headers=auth_headers
    ).status_code == 200
    db_session.expire_all()

    assert _pfc_category(db_session, user.id, "ENTERTAINMENT") == category_id
