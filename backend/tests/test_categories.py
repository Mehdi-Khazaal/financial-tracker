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

from models.database import Category, RecurringTransaction, Transaction


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
# The backend decides this, not the UI: `update_category` and `delete_category`
# both filter on `Category.user_id == current_user.id`, and a system category
# has `user_id IS NULL`, so neither can ever match one. The 404 detail strings
# say "not editable" / "not deletable" outright. Until Phase 6.0 the frontend
# rendered Edit and Delete on these rows anyway, so both actions always failed.


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
def system_category(db_session):
    """A global, user-less category — the shape the seeder produces."""
    row = Category(user_id=None, name="Groceries", type="expense", color="#5b8fff", is_system=True)
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
    assert response.status_code == 404
    db_session.expire_all()
    assert db_session.query(Category).filter_by(id=system_category.id).one().name == "Groceries"


def test_a_system_category_cannot_be_deleted(client, auth_headers, system_category, db_session):
    response = client.delete(f"/categories/{system_category.id}", headers=auth_headers)
    assert response.status_code == 404
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


# --- Duplicate and case-variant names ----------------------------------------
# There is no uniqueness constraint on (user_id, name, type) and no
# normalization on write. These tests pin that as current behaviour so a future
# migration has something explicit to change. No constraint is added here.


def test_duplicate_names_are_currently_allowed_CURRENT_BEHAVIOUR(client, auth_headers):
    payload = {"name": "Groceries", "type": "expense", "color": "#f97316"}
    first = client.post("/categories", json=payload, headers=auth_headers, follow_redirects=True)
    second = client.post("/categories", json=payload, headers=auth_headers, follow_redirects=True)
    assert first.status_code == 201
    assert second.status_code == 201, "No uniqueness constraint exists yet"
    assert first.json()["id"] != second.json()["id"]


def test_case_variants_are_distinct_categories_CURRENT_BEHAVIOUR(client, auth_headers):
    """`_pfc_category` matches category names case-insensitively.

    So two casings can both exist, and the auto-categorizer's `.first()` picks
    between them arbitrarily. Pinned, not fixed.
    """
    lower = client.post(
        "/categories", json={"name": "groceries", "type": "expense", "color": "#f97316"},
        headers=auth_headers, follow_redirects=True,
    )
    upper = client.post(
        "/categories", json={"name": "Groceries", "type": "expense", "color": "#f97316"},
        headers=auth_headers, follow_redirects=True,
    )
    assert lower.status_code == 201 and upper.status_code == 201
    assert lower.json()["id"] != upper.json()["id"]


def test_colour_is_not_validated_CURRENT_BEHAVIOUR(client, auth_headers):
    """`color` is a bare `String(7)` and reaches a style attribute unvalidated."""
    response = client.post(
        "/categories", json={"name": "Odd", "type": "expense", "color": "nonsense"},
        headers=auth_headers, follow_redirects=True,
    )
    assert response.status_code == 201, "No colour validation exists yet"
