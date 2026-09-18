"""Free-text search and the uncategorized filter on the transaction list."""

from datetime import date
from decimal import Decimal

from models.auth import User
from models.database import Transaction
from routers import assistant
from utils import auth as auth_utils


def _tx(db, user, account, description, *, merchant_name=None, merchant_key=None, category=None, day=date(2026, 3, 1)):
    row = Transaction(
        user_id=user.id, account_id=account.id, category_id=category.id if category else None,
        amount=Decimal("-10.00"), description=description, plaid_merchant_name=merchant_name,
        merchant_key=merchant_key, transaction_date=day,
    )
    db.add(row)
    db.commit()
    return row


def test_search_matches_description_merchant_name_and_key_case_insensitively(client, db_session, user, account, auth_headers):
    a = _tx(db_session, user, account, "NETFLIX.COM 866-579-7172")
    b = _tx(db_session, user, account, "CHECKCARD 0312", merchant_name="Netflix")
    c = _tx(db_session, user, account, "ODD BANK STRING", merchant_key="netflix")
    _tx(db_session, user, account, "SPOTIFY", merchant_key="spotify")

    res = client.get("/transactions/", headers=auth_headers, params={"search": "netflix"})
    assert res.status_code == 200
    assert {row["id"] for row in res.json()} == {a.id, b.id, c.id}


def test_search_treats_wildcards_literally_and_caps_length(client, db_session, user, account, auth_headers):
    _tx(db_session, user, account, "100% cotton")
    _tx(db_session, user, account, "1000 cotton")
    res = client.get("/transactions/", headers=auth_headers, params={"search": "100%"})
    assert [row["description"] for row in res.json()] == ["100% cotton"]
    assert client.get("/transactions/", headers=auth_headers, params={"search": "x" * 101}).status_code == 422


def test_uncategorized_filter_and_combination_with_search(client, db_session, user, account, category, auth_headers):
    filed = _tx(db_session, user, account, "NETFLIX", category=category)
    loose = _tx(db_session, user, account, "Netflix trial")
    _tx(db_session, user, account, "Rent")
    res = client.get("/transactions/", headers=auth_headers, params={"uncategorized": "true", "search": "netflix"})
    assert [row["id"] for row in res.json()] == [loose.id]
    assert filed.id in {row["id"] for row in client.get("/transactions/", headers=auth_headers, params={"search": "netflix"}).json()}


def test_search_never_crosses_tenants(client, db_session, user, account, auth_headers):
    other = User(email="o@example.com", username="o", hashed_password=auth_utils.get_password_hash("Password123"))
    db_session.add(other)
    db_session.commit()
    db_session.add(Transaction(user_id=other.id, account_id=account.id, amount=Decimal("-5"), description="NETFLIX THEIRS", transaction_date=date(2026, 3, 1)))
    db_session.commit()
    assert client.get("/transactions/", headers=auth_headers, params={"search": "netflix"}).json() == []


def test_assistant_search_uses_the_same_fields(db_session, user, account):
    _tx(db_session, user, account, "CHECKCARD 0312", merchant_name="Netflix")
    rows = assistant.READ_TOOLS["list_transactions"](db_session, user, search="netflix")
    assert [r["description"] for r in rows] == ["CHECKCARD 0312"]
