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

import pytest

from models.database import Category


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
