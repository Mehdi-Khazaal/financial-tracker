"""Verify snapshot materialization and the fast history endpoint path."""

from datetime import date, timedelta
from decimal import Decimal

from models.database import AccountBalanceSnapshot, Transaction
from services.balance_snapshots import refresh_snapshots_for_user


def test_refresh_snapshots_writes_month_end_balances(client, db_session, user, auth_headers, account):
    # Seed a transaction 45 days ago so the previous month's closing balance
    # differs from today's balance.
    past_date = date.today() - timedelta(days=45)
    db_session.add(Transaction(
        user_id=user.id,
        account_id=account.id,
        amount=Decimal("-100.00"),
        description="Old charge",
        transaction_date=past_date,
    ))
    account.balance = Decimal("900.00")
    db_session.commit()

    rows_written = refresh_snapshots_for_user(db_session, user.id, months_back=3)
    assert rows_written > 0

    snapshots = (
        db_session.query(AccountBalanceSnapshot)
        .filter_by(user_id=user.id, account_id=account.id)
        .order_by(AccountBalanceSnapshot.snapshot_date)
        .all()
    )
    assert len(snapshots) >= 3

    # A snapshot dated BEFORE the transaction must reflect the pre-charge
    # balance (900 + 100 = 1000). One dated AFTER must reflect the current 900.
    for snap in snapshots:
        if snap.snapshot_date < past_date:
            assert snap.closing_balance == Decimal("1000.00")
        else:
            assert snap.closing_balance == Decimal("900.00")


def test_refresh_snapshots_is_idempotent(db_session, user, account):
    first = refresh_snapshots_for_user(db_session, user.id, months_back=3)
    second = refresh_snapshots_for_user(db_session, user.id, months_back=3)
    assert first == second
    # Same number of rows before and after the second refresh.
    total = db_session.query(AccountBalanceSnapshot).filter_by(user_id=user.id).count()
    assert total == second


def test_net_worth_history_uses_snapshots(client, db_session, user, auth_headers, account):
    account.type = "checking"  # ensure not investment
    account.balance = Decimal("500.00")
    db_session.commit()

    refresh_snapshots_for_user(db_session, user.id, months_back=6)

    response = client.get("/history/net-worth?months=3", headers=auth_headers)
    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 3
    # With no future-dated transactions, every month should reflect the
    # current balance since snapshots exist for each.
    for entry in payload:
        assert entry["net_worth"] == 500.00
