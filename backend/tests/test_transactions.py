from decimal import Decimal
from datetime import date

from models.database import Transaction


def test_create_transaction_persists_row_and_updates_balance(client, db_session, auth_headers, account, category):
    response = client.post(
        "/transactions/",
        headers=auth_headers,
        json={
            "account_id": account.id,
            "category_id": category.id,
            "amount": "-25.50",
            "description": "Lunch",
            "transaction_date": "2026-06-12",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["description"] == "Lunch"

    db_session.refresh(account)
    assert Decimal(str(account.balance)) == Decimal("974.50")


def test_update_transaction_can_move_accounts_and_rebalance(client, db_session, auth_headers, user, account, second_account):
    transaction = Transaction(
        user_id=user.id,
        account_id=account.id,
        amount=Decimal("-40.00"),
        description="Groceries",
        transaction_date=date(2026, 6, 10),
    )
    db_session.add(transaction)
    account.balance = Decimal("960.00")
    db_session.commit()
    db_session.refresh(transaction)

    response = client.put(
        f"/transactions/{transaction.id}",
        headers=auth_headers,
        json={"account_id": second_account.id, "amount": "-55.00"},
    )

    assert response.status_code == 200

    db_session.refresh(account)
    db_session.refresh(second_account)
    assert Decimal(str(account.balance)) == Decimal("1000.00")
    assert Decimal(str(second_account.balance)) == Decimal("195.00")


def test_delete_transaction_restores_balance(client, db_session, auth_headers, user, account):
    transaction = Transaction(
        user_id=user.id,
        account_id=account.id,
        amount=Decimal("-20.00"),
        description="Coffee beans",
        transaction_date=date(2026, 6, 11),
    )
    db_session.add(transaction)
    account.balance = Decimal("980.00")
    db_session.commit()
    db_session.refresh(transaction)
    transaction_id = transaction.id

    response = client.delete(
        f"/transactions/{transaction_id}",
        headers=auth_headers,
    )

    assert response.status_code == 204
    db_session.expire_all()
    db_session.refresh(account)
    assert Decimal(str(account.balance)) == Decimal("1000.00")
    assert db_session.get(Transaction, transaction_id) is None
