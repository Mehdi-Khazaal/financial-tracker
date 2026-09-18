"""Every path that posts a transaction must move the balance the same way.

Four places used to write a `Transaction` and adjust `Account.balance` on
their own instead of through `LedgerService`: savings-goal spends, the
assistant's confirmed `add_transaction`, recurring posting (router and cron)
and variable-bill logging. Each did `balance = Decimal(str(balance)) ± amount`
in Python — a read-modify-write that loses whichever concurrent write lands
first — and none of them ran merchant enrichment, so those rows had no
`merchant_key` and never matched a tracked bill.

The first group of tests pins the arithmetic those paths already got right,
so the refactor cannot change a single number. The second group states the
new guarantees: a stale in-memory balance no longer overwrites a concurrent
write, and every posted row carries merchant identity.
"""

from datetime import date
from decimal import Decimal

from models.database import Account, SavingsGoal, SavingsGoalAllocation, Transaction
from routers import assistant
from services.ledger import LedgerService


def _goal_with_allocation(db_session, user, account, allocated="200.00"):
    goal = SavingsGoal(user_id=user.id, name="Trip", target_amount=Decimal("500.00"))
    db_session.add(goal)
    db_session.flush()
    db_session.add(
        SavingsGoalAllocation(
            user_id=user.id, goal_id=goal.id, account_id=account.id, amount=Decimal(allocated)
        )
    )
    db_session.commit()
    db_session.refresh(goal)
    return goal


# ─── Pinned arithmetic ────────────────────────────────────────────────────────
def test_savings_spend_records_an_expense_and_moves_the_balance(client, db_session, user, auth_headers, account):
    goal = _goal_with_allocation(db_session, user, account)
    opening = Decimal(str(account.balance))

    response = client.post(
        f"/savings-goals/{goal.id}/spend",
        headers=auth_headers,
        json={"account_id": account.id, "amount": "50.00", "description": "Flights", "transaction_date": "2026-06-12"},
    )

    assert response.status_code == 200
    assert Decimal(str(response.json()["current_amount"])) == Decimal("150.00")

    db_session.expire_all()
    assert Decimal(str(db_session.get(Account, account.id).balance)) == opening - Decimal("50.00")
    row = db_session.query(Transaction).filter(Transaction.user_id == user.id).one()
    assert Decimal(str(row.amount)) == Decimal("-50.00")
    assert row.description == "Flights"
    assert row.transaction_date == date(2026, 6, 12)
    assert row.account_id == account.id


def test_savings_spend_of_the_whole_allocation_removes_it(client, db_session, user, auth_headers, account):
    goal = _goal_with_allocation(db_session, user, account, allocated="80.00")

    response = client.post(
        f"/savings-goals/{goal.id}/spend",
        headers=auth_headers,
        json={"account_id": account.id, "amount": "80.00", "transaction_date": "2026-06-12"},
    )

    assert response.status_code == 200
    assert response.json()["allocations"] == []
    db_session.expire_all()
    assert db_session.query(SavingsGoalAllocation).count() == 0
    assert Decimal(str(db_session.get(Account, account.id).balance)) == Decimal("920.00")


def test_savings_spend_beyond_the_allocation_writes_nothing(client, db_session, user, auth_headers, account):
    goal = _goal_with_allocation(db_session, user, account, allocated="20.00")
    opening = Decimal(str(account.balance))

    response = client.post(
        f"/savings-goals/{goal.id}/spend",
        headers=auth_headers,
        json={"account_id": account.id, "amount": "25.00", "transaction_date": "2026-06-12"},
    )

    assert response.status_code == 400
    db_session.expire_all()
    assert Decimal(str(db_session.get(Account, account.id).balance)) == opening
    assert db_session.query(Transaction).count() == 0


def test_assistant_confirmed_transaction_moves_the_balance(client, db_session, user, auth_headers, account, category):
    assistant._pending_actions.clear()
    payload = {
        "account_id": account.id,
        "amount": 40,
        "direction": "expense",
        "description": "Coffee beans",
        "transaction_date": "2026-06-12",
        "category": category.name,
    }
    token = assistant._register_pending_action(user.id, None, "add_transaction", payload)
    opening = Decimal(str(account.balance))

    response = client.post(
        "/assistant/execute",
        headers=auth_headers,
        json={"tool": "add_transaction", "input": payload, "action_token": token},
    )

    assert response.status_code == 200, response.text
    db_session.expire_all()
    assert Decimal(str(db_session.get(Account, account.id).balance)) == opening - Decimal("40")
    row = db_session.query(Transaction).filter(Transaction.user_id == user.id).one()
    assert Decimal(str(row.amount)) == Decimal("-40")
    assert row.category_id == category.id
    assert row.description == "Coffee beans"


def test_assistant_confirmed_income_is_positive(client, db_session, user, auth_headers, account):
    assistant._pending_actions.clear()
    payload = {"account_id": account.id, "amount": 12.5, "direction": "income", "transaction_date": "2026-06-12"}
    token = assistant._register_pending_action(user.id, None, "add_transaction", payload)

    response = client.post(
        "/assistant/execute",
        headers=auth_headers,
        json={"tool": "add_transaction", "input": payload, "action_token": token},
    )

    assert response.status_code == 200, response.text
    db_session.expire_all()
    assert Decimal(str(db_session.get(Account, account.id).balance)) == Decimal("1012.5")


# ─── New guarantees ───────────────────────────────────────────────────────────
def test_staged_posting_survives_a_concurrent_balance_write(db_session, user, account):
    """The classic lost update, and the reason every path now shares one helper.

    Session A has already loaded the account when session B (a Plaid sync, a
    second request) moves the balance. A then posts a charge. With Python
    arithmetic A would write `stale + delta` and B's update would vanish; with
    the SQL expression the database applies the delta to whatever is there.
    """
    from sqlalchemy.orm import Session

    stale = db_session.get(Account, account.id)
    assert Decimal(str(stale.balance)) == Decimal("1000")

    other = Session(bind=db_session.get_bind())
    try:
        other.query(Account).filter(Account.id == account.id).update({"balance": Decimal("1500.00")})
        other.commit()
    finally:
        other.close()

    LedgerService(db_session).stage_transaction(
        user.id,
        {"account_id": account.id, "amount": Decimal("-50.00"), "description": "Rent", "transaction_date": date(2026, 6, 1)},
    )
    db_session.commit()
    db_session.expire_all()

    assert Decimal(str(db_session.get(Account, account.id).balance)) == Decimal("1450.00")


def test_savings_spend_row_carries_merchant_identity(client, db_session, user, auth_headers, account):
    goal = _goal_with_allocation(db_session, user, account)

    client.post(
        f"/savings-goals/{goal.id}/spend",
        headers=auth_headers,
        json={"account_id": account.id, "amount": "10.00", "description": "SQ *COFFEE BAR 123", "transaction_date": "2026-06-12"},
    )

    row = db_session.query(Transaction).one()
    assert row.merchant_key == "coffee bar"


def test_assistant_confirmed_transaction_carries_merchant_identity(client, db_session, user, auth_headers, account):
    assistant._pending_actions.clear()
    payload = {"account_id": account.id, "amount": 9, "direction": "expense", "description": "NETFLIX.COM", "transaction_date": "2026-06-12"}
    token = assistant._register_pending_action(user.id, None, "add_transaction", payload)

    client.post("/assistant/execute", headers=auth_headers, json={"tool": "add_transaction", "input": payload, "action_token": token})

    row = db_session.query(Transaction).one()
    assert row.merchant_key == "netflix"
    assert row.category_source is None


def test_stage_transaction_keeps_an_explicit_merchant_key(db_session, user, account):
    """Recurring posting passes the bill's own identity, which must win over
    the key derived from the description."""
    row = LedgerService(db_session).stage_transaction(
        user.id,
        {
            "account_id": account.id,
            "amount": Decimal("-15.00"),
            "description": "Landlord",
            "merchant_key": "rent",
            "transaction_date": date(2026, 6, 1),
        },
    )
    db_session.commit()
    assert row.merchant_key == "rent"


def test_stage_transaction_rejects_a_foreign_account_without_side_effects(db_session, user, account):
    from models.auth import User
    from services.ledger import LedgerResourceNotFound
    from utils import auth as auth_utils
    import pytest

    other = User(email="o@example.com", username="o", hashed_password=auth_utils.get_password_hash("Password123"))
    db_session.add(other)
    db_session.commit()
    theirs = Account(user_id=other.id, name="Theirs", type="checking", balance=Decimal("5.00"))
    db_session.add(theirs)
    db_session.commit()

    with pytest.raises(LedgerResourceNotFound):
        LedgerService(db_session).stage_transaction(
            user.id, {"account_id": theirs.id, "amount": Decimal("-1.00"), "transaction_date": date(2026, 6, 1)}
        )
    db_session.rollback()
    assert db_session.query(Transaction).count() == 0
    assert Decimal(str(db_session.get(Account, theirs.id).balance)) == Decimal("5.00")
