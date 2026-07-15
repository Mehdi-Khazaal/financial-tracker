from datetime import date
from decimal import Decimal

from models.database import Transfer


def test_delete_account_with_transfer_history_is_blocked(
    client,
    db_session,
    user,
    auth_headers,
    account,
    second_account,
):
    transfer = Transfer(
        user_id=user.id,
        from_account_id=account.id,
        to_account_id=second_account.id,
        amount=Decimal("50.00"),
        transfer_date=date.today(),
    )
    db_session.add(transfer)
    db_session.commit()

    response = client.delete(f"/accounts/{account.id}", headers=auth_headers)

    assert response.status_code == 409
    assert response.json()["detail"] == "Account with financial history cannot be deleted"
    db_session.refresh(account)
    db_session.refresh(second_account)
    assert account.balance == Decimal("1000.00")
    assert second_account.balance == Decimal("250.00")


def test_delete_empty_account_remains_supported(client, db_session, auth_headers, account):
    account_id = account.id
    response = client.delete(f"/accounts/{account_id}", headers=auth_headers)

    assert response.status_code == 204
    db_session.expire_all()
    assert db_session.get(type(account), account_id) is None
