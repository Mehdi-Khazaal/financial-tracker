"""Past balances count transfers between the user's own accounts.

History is rebuilt by walking back from today's balance through every movement
dated later. Transfers were not movements: the walk read only transactions, so
moving $1,500 from checking to cash in August left both histories wrong by
$1,500 for every month before August. On the live account the checking history
reached −$23,438.93.

On a bank-linked account the bank also reports the move as a transaction, and
the two must not both count.
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from models.database import Account, AccountBalanceSnapshot, Transaction, Transfer
from services.balance_snapshots import balance_movements, refresh_snapshots_for_user
from utils.dates import user_today


@pytest.fixture
def today(user):
    return user_today(user)


@pytest.fixture
def cash(db_session, user):
    row = Account(user_id=user.id, name="Home", type="cash", balance=Decimal("1500.00"), currency="USD")
    db_session.add(row)
    db_session.commit()
    return row


def _last_month_end(today: date) -> date:
    return today.replace(day=1) - timedelta(days=1)


def _transfer(db, user, source, target, amount, on):
    db.add(Transfer(user_id=user.id, from_account_id=source.id, to_account_id=target.id,
                    amount=Decimal(amount), transfer_date=on))
    db.commit()


def _histories(client, auth_headers, months=2):
    response = client.get(f"/history/accounts?months={months}", headers=auth_headers)
    assert response.status_code == 200
    return response.json()


def test_a_transfer_moves_both_histories(client, db_session, user, auth_headers, account, cash, today):
    """$1,500 moved from checking to cash this month: last month it was still in checking."""
    account.balance = Decimal("0.00")
    db_session.commit()
    _transfer(db_session, user, account, cash, "1500.00", today)

    body = _histories(client, auth_headers)

    assert [p["balance"] for p in body[str(account.id)]] == ["1500.00", "0.00"]
    assert [p["balance"] for p in body[str(cash.id)]] == ["0.00", "1500.00"]


def test_a_transfer_does_not_change_net_worth_history(client, db_session, user, auth_headers, account, cash, today):
    account.balance = Decimal("0.00")
    db_session.commit()
    _transfer(db_session, user, account, cash, "1500.00", today)

    points = client.get("/history/net-worth?months=2", headers=auth_headers).json()

    assert [p["net_worth"] for p in points] == ["1500.00", "1500.00"]


def test_on_a_linked_account_the_banks_row_wins(db_session, user, account, cash, today):
    """The bank imported the withdrawal too; it must move checking once, not twice."""
    account.plaid_account_id = "plaid-checking"
    db_session.add(Transaction(user_id=user.id, account_id=account.id, amount=Decimal("-1500.00"),
                               description="ATM WITHDRAWAL", transaction_date=today - timedelta(days=1)))
    db_session.commit()
    _transfer(db_session, user, account, cash, "1500.00", today)

    moves = balance_movements(db_session, user.id, [account, cash])

    assert [amount for _, amount in moves[account.id]] == [Decimal("-1500.00")]
    # The cash account has no bank copy, so its leg always counts.
    assert [amount for _, amount in moves[cash.id]] == [Decimal("1500.00")]


def test_on_a_linked_account_a_transfer_fills_in_a_deleted_bank_row(db_session, user, account, cash, today):
    """The live account deleted the bank's copies; the recorded transfer is then the only record."""
    account.plaid_account_id = "plaid-checking"
    db_session.commit()
    _transfer(db_session, user, account, cash, "1500.00", today)

    moves = balance_movements(db_session, user.id, [account])

    assert [amount for _, amount in moves[account.id]] == [Decimal("-1500.00")]


def test_each_bank_row_answers_for_one_transfer(db_session, user, account, cash, today):
    """Two equal moves in one week and one bank row: one transfer leg still counts."""
    account.plaid_account_id = "plaid-checking"
    db_session.add(Transaction(user_id=user.id, account_id=account.id, amount=Decimal("-100.00"),
                               description="ATM", transaction_date=today))
    db_session.commit()
    _transfer(db_session, user, account, cash, "100.00", today)
    _transfer(db_session, user, account, cash, "100.00", today - timedelta(days=2))

    moves = balance_movements(db_session, user.id, [account])

    assert sorted(amount for _, amount in moves[account.id]) == [Decimal("-100.00"), Decimal("-100.00")]


def test_a_bank_row_far_from_the_transfer_does_not_match(db_session, user, account, cash, today):
    account.plaid_account_id = "plaid-checking"
    db_session.add(Transaction(user_id=user.id, account_id=account.id, amount=Decimal("-1500.00"),
                               description="Rent", transaction_date=today - timedelta(days=20)))
    db_session.commit()
    _transfer(db_session, user, account, cash, "1500.00", today)

    moves = balance_movements(db_session, user.id, [account])

    assert sorted(amount for _, amount in moves[account.id]) == [Decimal("-1500.00"), Decimal("-1500.00")]


def test_stored_snapshots_count_transfers_too(db_session, user, account, cash, today):
    account.balance = Decimal("0.00")
    db_session.commit()
    _transfer(db_session, user, account, cash, "1500.00", today)

    refresh_snapshots_for_user(db_session, user.id, months_back=2, today=today)
    snapshot = (
        db_session.query(AccountBalanceSnapshot)
        .filter_by(account_id=account.id, snapshot_date=_last_month_end(today))
        .one()
    )

    assert snapshot.closing_balance == Decimal("1500.00")


def test_another_users_transfers_never_move_my_history(db_session, user, account, cash, today):
    from models.auth import User
    from utils import auth as auth_utils

    stranger = User(email="stranger-transfer@example.com", username="strangertr",
                    hashed_password=auth_utils.get_password_hash("Password123"),
                    is_verified=True, is_admin=False)
    db_session.add(stranger)
    db_session.commit()
    theirs = Account(user_id=stranger.id, name="Theirs", type="cash", balance=Decimal("0"), currency="USD")
    db_session.add(theirs)
    db_session.commit()
    db_session.add(Transfer(user_id=stranger.id, from_account_id=theirs.id, to_account_id=theirs.id,
                            amount=Decimal("999"), transfer_date=today))
    db_session.commit()

    moves = balance_movements(db_session, user.id, [account, cash])

    assert moves == {account.id: [], cash.id: []}
