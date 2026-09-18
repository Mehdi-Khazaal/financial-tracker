"""Query budgets for the hot read paths.

Each endpoint here is called on every dashboard load or pull-to-refresh.
The counts are ceilings, not targets: a test fails only when a change adds
queries the previous version did not need — the shape of an N+1. Numbers were
measured, then rounded up slightly so an extra defensive lookup does not fail
CI, while a per-row loop still does.

Counting is done at the DBAPI cursor, so it sees exactly what the database
sees, on the same SQLite the rest of the suite uses.
"""

from contextlib import contextmanager
from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import event

from models.database import Account, Category, RecurringTransaction, SavingsGoal, SavingsGoalAllocation, Transaction


@contextmanager
def count_queries(engine):
    statements: list[str] = []

    def _before(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _before)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", _before)


@pytest.fixture
def busy_ledger(db_session, user, account, second_account, category):
    """Three hundred transactions across two accounts, a few bills and goals."""
    third = Account(user_id=user.id, name="Card", type="credit_card", balance=Decimal("-200.00"))
    db_session.add(third)
    db_session.flush()
    accounts = [account, second_account, third]
    today = date.today()
    rows = []
    for index in range(300):
        rows.append(Transaction(
            user_id=user.id,
            account_id=accounts[index % 3].id,
            category_id=category.id if index % 2 else None,
            amount=Decimal("-12.50") if index % 5 else Decimal("1500.00"),
            description=f"Merchant {index % 17}",
            merchant_key=f"merchant {index % 17}",
            transaction_date=today - timedelta(days=index),
        ))
    db_session.add_all(rows)
    for index in range(5):
        db_session.add(RecurringTransaction(
            user_id=user.id, account_id=account.id, category_id=category.id,
            amount=Decimal("-9.99"), description=f"Bill {index}", period="monthly",
            next_date=today + timedelta(days=index + 1), merchant_key=f"bill {index}",
        ))
    for index in range(2):
        goal = SavingsGoal(user_id=user.id, name=f"Goal {index}", target_amount=Decimal("500.00"))
        db_session.add(goal)
        db_session.flush()
        db_session.add(SavingsGoalAllocation(user_id=user.id, goal_id=goal.id, account_id=second_account.id, amount=Decimal("50.00")))
    db_session.commit()
    return db_session.get_bind()


# (path, ceiling). Measured on 2026-09-17 before any Phase 3 tuning; see the
# upgrade log for the before/after table.
BUDGETS = [
    ("/accounts/", 4),
    ("/transactions/?limit=500", 3),
    ("/categories/", 3),
    ("/savings-goals/", 5),
    ("/history/net-worth?months=12", 6),
    ("/history/accounts?months=6", 4),
    ("/recurring/", 6),
    # Cold: includes the detection pass plus the four fingerprint aggregates
    # that decide whether the cached result can be reused (see the warm test).
    ("/recurring/overview", 20),
    ("/loans/", 2),
    ("/assets/", 4),
]


@pytest.mark.parametrize("path, ceiling", BUDGETS)
def test_hot_read_paths_stay_within_their_query_budget(client, auth_headers, busy_ledger, path, ceiling):
    with count_queries(busy_ledger) as statements:
        response = client.get(path, headers=auth_headers)
    assert response.status_code == 200, response.text
    # The auth dependency's user lookup is part of every request and counted.
    assert len(statements) <= ceiling, (
        f"{path} issued {len(statements)} queries (budget {ceiling}):\n" + "\n".join(statements)
    )


def test_recurring_overview_warm_path_skips_detection(client, auth_headers, busy_ledger):
    """The second load of the Recurring page reuses cached detection.

    Detection itself costs five queries and a Python pass over up to 800 days
    of rows; the cache check costs four aggregate queries. So a warm load is
    cheaper by at least one query and, more importantly, by all the Python.
    """
    client.get("/recurring/overview", headers=auth_headers)
    with count_queries(busy_ledger) as statements:
        response = client.get("/recurring/overview", headers=auth_headers)
    assert response.status_code == 200
    assert len(statements) <= 15, "\n".join(statements)
