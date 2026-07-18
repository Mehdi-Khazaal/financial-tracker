from datetime import date
from decimal import Decimal

from models.auth import User
from models.database import Account, Transaction
from utils.auth import get_password_hash


def test_account_histories_are_batched_and_tenant_scoped(
    client,
    db_session,
    user,
    auth_headers,
    account,
    second_account,
):
    account.balance = Decimal("900.00")
    db_session.add(
        Transaction(
            user_id=user.id,
            account_id=account.id,
            amount=Decimal("-100.00"),
            description="Current month expense",
            transaction_date=date.today(),
        )
    )
    other_user = User(
        email="history-other@example.com",
        username="history-other",
        hashed_password=get_password_hash("Password123"),
        is_verified=True,
    )
    db_session.add(other_user)
    db_session.flush()
    other_account = Account(
        user_id=other_user.id,
        name="Hidden account",
        type="checking",
        balance=Decimal("5000.00"),
        currency="USD",
    )
    db_session.add(other_account)
    db_session.commit()

    response = client.get("/history/accounts?months=2", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {str(account.id), str(second_account.id)}
    assert [row["balance"] for row in body[str(account.id)]] == [1000.0, 900.0]
    assert [row["balance"] for row in body[str(second_account.id)]] == [250.0, 250.0]
    assert str(other_account.id) not in body