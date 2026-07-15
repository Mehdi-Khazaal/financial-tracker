from decimal import Decimal
from datetime import date

from models.auth import User
from models.database import Category, Transaction
from routers.plaid_router import _apply_pending_replacement
from utils import auth as auth_utils


def _create_other_category(db_session):
    other_user = User(
        email="transaction-other@example.com",
        username="transaction-other",
        hashed_password=auth_utils.get_password_hash("Password123"),
        is_verified=True,
        is_admin=False,
    )
    db_session.add(other_user)
    db_session.commit()
    db_session.refresh(other_user)
    category = Category(
        user_id=other_user.id,
        name="Other private",
        type="expense",
        color="#112233",
    )
    db_session.add(category)
    db_session.commit()
    db_session.refresh(category)
    return category


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


def test_create_transaction_rejects_cross_tenant_category_without_changing_balance(
    client, db_session, auth_headers, account
):
    other_category = _create_other_category(db_session)

    response = client.post(
        "/transactions/",
        headers=auth_headers,
        json={
            "account_id": account.id,
            "category_id": other_category.id,
            "amount": "-25.50",
            "description": "Should not persist",
            "transaction_date": "2026-06-12",
        },
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Category not found"}
    db_session.expire_all()
    assert Decimal(str(db_session.get(type(account), account.id).balance)) == Decimal("1000.00")
    assert db_session.query(Transaction).count() == 0


def test_create_transaction_accepts_visible_system_category(
    client, db_session, auth_headers, account
):
    system_category = Category(
        user_id=None,
        name="System food",
        type="expense",
        color="#334455",
        is_system=True,
    )
    db_session.add(system_category)
    db_session.commit()
    db_session.refresh(system_category)

    response = client.post(
        "/transactions/",
        headers=auth_headers,
        json={
            "account_id": account.id,
            "category_id": system_category.id,
            "amount": "-10.00",
            "description": "System category",
            "transaction_date": "2026-06-12",
        },
    )

    assert response.status_code == 201
    assert response.json()["category_id"] == system_category.id


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


def test_update_transaction_rejects_cross_tenant_category_without_partial_rebalance(
    client, db_session, auth_headers, user, account, second_account, category
):
    other_category = _create_other_category(db_session)
    transaction = Transaction(
        user_id=user.id,
        account_id=account.id,
        category_id=category.id,
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
        json={
            "account_id": second_account.id,
            "category_id": other_category.id,
            "amount": "-55.00",
        },
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Category not found"}
    db_session.expire_all()
    persisted = db_session.get(Transaction, transaction.id)
    assert persisted.account_id == account.id
    assert persisted.category_id == category.id
    assert Decimal(str(persisted.amount)) == Decimal("-40.00")
    assert Decimal(str(db_session.get(type(account), account.id).balance)) == Decimal("960.00")
    assert Decimal(str(db_session.get(type(second_account), second_account.id).balance)) == Decimal("250.00")


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


def test_plaid_pending_replacement_preserves_category(db_session, user, account, category):
    pending = Transaction(
        user_id=user.id,
        account_id=account.id,
        category_id=category.id,
        amount=Decimal("-12.34"),
        description="Pending Coffee",
        plaid_tx_id="pending-123",
        transaction_date=date(2026, 6, 18),
    )
    db_session.add(pending)
    db_session.commit()
    db_session.refresh(pending)

    replaced = _apply_pending_replacement(
        db_session,
        {
            "account_id": "plaid-account-1",
            "transaction_id": "posted-456",
            "pending_transaction_id": "pending-123",
            "amount": 12.34,
            "merchant_name": "Coffee Shop",
            "date": "2026-06-19",
        },
        user.id,
        account,
    )

    assert replaced is True
    assert pending.category_id == category.id
    assert pending.plaid_tx_id == "posted-456"
    assert pending.description == "Coffee Shop"
    assert pending.transaction_date == date(2026, 6, 19)
    assert Decimal(str(pending.amount)) == Decimal("-12.34")


def test_plaid_pending_replacement_merges_duplicate_posted_row(db_session, user, account, category):
    pending = Transaction(
        user_id=user.id,
        account_id=account.id,
        category_id=category.id,
        amount=Decimal("-12.34"),
        description="Pending Coffee",
        plaid_tx_id="pending-123",
        transaction_date=date(2026, 6, 18),
    )
    posted = Transaction(
        user_id=user.id,
        account_id=account.id,
        category_id=None,
        amount=Decimal("-12.34"),
        description="Coffee",
        plaid_tx_id="posted-456",
        transaction_date=date(2026, 6, 19),
    )
    db_session.add_all([pending, posted])
    db_session.commit()
    pending_id = pending.id

    replaced = _apply_pending_replacement(
        db_session,
        {
            "account_id": "plaid-account-1",
            "transaction_id": "posted-456",
            "pending_transaction_id": "pending-123",
            "amount": 12.34,
            "merchant_name": "Coffee Shop",
            "date": "2026-06-19",
        },
        user.id,
        account,
    )
    db_session.commit()
    db_session.refresh(posted)

    assert replaced is True
    assert posted.category_id == category.id
    assert posted.description == "Coffee Shop"
    assert db_session.get(Transaction, pending_id) is None
