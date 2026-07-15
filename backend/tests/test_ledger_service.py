from datetime import date
from decimal import Decimal

import pytest

from models.database import Account, Transaction
from services.ledger import LedgerService


def test_create_rolls_back_all_ledger_changes_when_commit_fails(
    db_session, monkeypatch, user, account
):
    service = LedgerService(db_session)

    def fail_commit():
        raise RuntimeError("commit failed")

    monkeypatch.setattr(db_session, "commit", fail_commit)

    with pytest.raises(RuntimeError, match="commit failed"):
        service.create_transaction(
            user.id,
            {
                "account_id": account.id,
                "category_id": None,
                "amount": Decimal("-25.00"),
                "description": "Rolled back",
                "transaction_date": date(2026, 6, 12),
            },
        )

    monkeypatch.undo()
    assert db_session.is_active
    assert db_session.query(Transaction).count() == 0
    persisted_account = db_session.get(Account, account.id)
    assert Decimal(str(persisted_account.balance)) == Decimal("1000.00")
