"""Review suggests rows that look like moves between your own accounts.

Suggestions only: nothing is filed until the user confirms, and confirming
keeps the rows (so balances and history stay right) under the Transfer
category (so they never count as income or spending).
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from models.auth import User
from models.database import Account, Category, Transaction, TransactionSplit
from utils import auth as auth_utils

DAY = date(2026, 11, 3)


@pytest.fixture
def card(db_session, user):
    row = Account(user_id=user.id, name="VentureOne", type="credit_card", balance=Decimal("-384.92"),
                  credit_limit=Decimal("2750"), currency="USD", plaid_account_id="card-1")
    db_session.add(row)
    db_session.commit()
    return row


def _tx(db, user, account, amount, on=DAY, description="Entry", **extra):
    row = Transaction(user_id=user.id, account_id=account.id, amount=Decimal(str(amount)),
                      description=description, transaction_date=on, **extra)
    db.add(row)
    db.commit()
    return row


def _suggestions(client, auth_headers):
    response = client.get("/transactions/transfer-suggestions", headers=auth_headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_a_card_payment_from_checking_is_suggested_as_one_pair(client, db_session, user, auth_headers, account, card):
    out = _tx(db_session, user, account, "-384.92", DAY, "CAPITAL ONE ONLINE PMT")
    into = _tx(db_session, user, card, "384.92", DAY + timedelta(days=1), "PAYMENT THANK YOU")

    body = _suggestions(client, auth_headers)

    assert len(body) == 1
    assert body[0]["reason"] == "pair"
    assert sorted(body[0]["transaction_ids"]) == sorted([out.id, into.id])
    assert body[0]["from_account_id"] == account.id
    assert body[0]["to_account_id"] == card.id
    assert body[0]["amount"] == "384.92"
    assert "1 day later" in body[0]["detail"]


def test_each_row_belongs_to_one_pair_and_the_nearest_date_wins(
    client, db_session, user, auth_headers, account, second_account,
):
    far = _tx(db_session, user, second_account, "500", DAY + timedelta(days=3))
    near = _tx(db_session, user, second_account, "500", DAY)
    out = _tx(db_session, user, account, "-500", DAY)

    body = _suggestions(client, auth_headers)
    pairs = [s for s in body if s["reason"] == "pair"]

    assert len(pairs) == 1
    assert sorted(pairs[0]["transaction_ids"]) == sorted([out.id, near.id])
    assert far.id not in pairs[0]["transaction_ids"]


def test_rows_too_far_apart_or_on_the_same_account_are_not_a_pair(
    client, db_session, user, auth_headers, account, second_account,
):
    _tx(db_session, user, account, "-200", DAY)
    _tx(db_session, user, second_account, "200", DAY + timedelta(days=9))
    _tx(db_session, user, account, "-75", DAY)
    _tx(db_session, user, account, "75", DAY)

    assert [s for s in _suggestions(client, auth_headers) if s["reason"] == "pair"] == []


def test_a_payment_into_a_card_alone_is_suggested(client, db_session, user, auth_headers, card):
    payment = _tx(db_session, user, card, "120", DAY, "AUTOPAY")

    body = _suggestions(client, auth_headers)

    assert [(s["reason"], s["transaction_ids"]) for s in body] == [("card-payment", [payment.id])]


def test_the_banks_own_category_is_a_signal(client, db_session, user, auth_headers, account):
    flagged = _tx(db_session, user, account, "-300", DAY, "WEB XFER",
                  personal_finance_category_primary="TRANSFER_OUT",
                  personal_finance_category_detailed="TRANSFER_OUT_SAVINGS")
    _tx(db_session, user, account, "-40", DAY, "ZELLE TO A FRIEND",
        personal_finance_category_primary="TRANSFER_OUT",
        personal_finance_category_detailed="TRANSFER_OUT_ACCOUNT_TRANSFER")

    body = _suggestions(client, auth_headers)

    assert [s["transaction_ids"] for s in body] == [[flagged.id]]
    assert body[0]["detail"] == "Your bank marks this as a move to savings."


def test_a_cash_withdrawal_is_a_move_only_when_cash_is_tracked(client, db_session, user, auth_headers, account):
    atm = _tx(db_session, user, account, "-400", DAY, "ATM WITHDRAWAL",
              personal_finance_category_detailed="TRANSFER_OUT_WITHDRAWAL")
    assert _suggestions(client, auth_headers) == []

    db_session.add(Account(user_id=user.id, name="Home", type="cash", balance=Decimal("0"), currency="USD"))
    db_session.commit()

    assert [s["transaction_ids"] for s in _suggestions(client, auth_headers)] == [[atm.id]]


def test_categorized_and_split_rows_are_never_suggested(client, db_session, user, auth_headers, account, card, category):
    _tx(db_session, user, account, "-50", DAY, category_id=category.id)
    _tx(db_session, user, card, "50", DAY, category_id=category.id)
    parent = _tx(db_session, user, card, "60", DAY)
    db_session.add(TransactionSplit(user_id=user.id, transaction_id=parent.id, category_id=category.id, amount=Decimal("60")))
    db_session.commit()

    assert _suggestions(client, auth_headers) == []


def test_confirming_files_both_rows_under_transfer_and_clears_the_suggestion(
    client, db_session, user, auth_headers, account, card,
):
    out = _tx(db_session, user, account, "-384.92")
    into = _tx(db_session, user, card, "384.92")

    response = client.post("/transactions/mark-transfer", json={"transaction_ids": [out.id, into.id]}, headers=auth_headers)

    assert response.status_code == 200, response.text
    assert response.json()["updated"] == 2
    category = db_session.get(Category, response.json()["category_id"])
    assert (category.name, category.type) == ("Transfer", "transfer")
    db_session.expire_all()
    assert {db_session.get(Transaction, out.id).category_id, db_session.get(Transaction, into.id).category_id} == {category.id}
    assert db_session.get(Transaction, out.id).category_source == "user"
    assert _suggestions(client, auth_headers) == []


def test_confirming_reuses_an_existing_transfer_category(client, db_session, user, auth_headers, account):
    existing = Category(user_id=user.id, name="Transfer", type="transfer", is_system=True)
    db_session.add(existing)
    db_session.commit()
    row = _tx(db_session, user, account, "-10")

    body = client.post("/transactions/mark-transfer", json={"transaction_ids": [row.id]}, headers=auth_headers).json()

    assert body["category_id"] == existing.id
    assert db_session.query(Category).filter_by(user_id=user.id, type="transfer").count() == 1


def test_confirming_is_all_or_nothing_and_never_touches_another_users_rows(
    client, db_session, user, auth_headers, account,
):
    stranger = User(email="stranger-mark@example.com", username="strangermark",
                    hashed_password=auth_utils.get_password_hash("Password123"), is_verified=True)
    db_session.add(stranger)
    db_session.commit()
    theirs_account = Account(user_id=stranger.id, name="Theirs", type="checking", balance=Decimal("0"), currency="USD")
    db_session.add(theirs_account)
    db_session.commit()
    mine = _tx(db_session, user, account, "-10")
    theirs = _tx(db_session, stranger, theirs_account, "-10")

    response = client.post("/transactions/mark-transfer", json={"transaction_ids": [mine.id, theirs.id]}, headers=auth_headers)

    assert response.status_code == 404
    db_session.expire_all()
    assert db_session.get(Transaction, mine.id).category_id is None
    assert db_session.get(Transaction, theirs.id).category_id is None


def test_a_split_transaction_cannot_be_filed_as_a_transfer(client, db_session, user, auth_headers, account, category):
    parent = _tx(db_session, user, account, "-60")
    db_session.add(TransactionSplit(user_id=user.id, transaction_id=parent.id, category_id=category.id, amount=Decimal("-60")))
    db_session.commit()

    response = client.post("/transactions/mark-transfer", json={"transaction_ids": [parent.id]}, headers=auth_headers)

    assert response.status_code == 400


def test_another_users_rows_are_never_suggested(client, db_session, user, auth_headers, account):
    stranger = User(email="stranger-suggest@example.com", username="strangersug",
                    hashed_password=auth_utils.get_password_hash("Password123"), is_verified=True)
    db_session.add(stranger)
    db_session.commit()
    theirs = Account(user_id=stranger.id, name="Theirs", type="savings", balance=Decimal("0"), currency="USD")
    db_session.add(theirs)
    db_session.commit()
    _tx(db_session, user, account, "-250")
    _tx(db_session, stranger, theirs, "250")

    assert _suggestions(client, auth_headers) == []
