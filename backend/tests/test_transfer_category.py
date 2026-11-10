"""A Transfer category: money moving between your own accounts.

On the live account every card payment and every move between checking and
savings had been deleted after import, because there was nowhere to file them
that kept them out of spending. Deleting them broke every account's history.
A transaction filed under a `transfer` category stays in the ledger (so
balances and history are right) and counts as neither income nor spending.
"""

import importlib
from datetime import date, timedelta
from decimal import Decimal

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations

from models.auth import User
from models.database import Account, Category, Transaction
from routers.assistant import tools
from routers.auth import seed_user_categories
from services import recurring_detection, weekly_summary
from services.classification import Lookups, classify_values
from utils import auth as auth_utils
from utils.dates import user_today


@pytest.fixture
def transfer(db_session, user):
    row = Category(user_id=user.id, name="Transfer", type="transfer", color="#7880a0")
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def card(db_session, user):
    row = Account(user_id=user.id, name="VentureOne", type="credit_card", balance=Decimal("-384.92"),
                  credit_limit=Decimal("2750"), currency="USD")
    db_session.add(row)
    db_session.commit()
    return row


def _tx(db, user, account, amount, on, category=None, description="Entry"):
    row = Transaction(user_id=user.id, account_id=account.id, amount=Decimal(str(amount)),
                      description=description, transaction_date=on,
                      category_id=category.id if category else None)
    db.add(row)
    db.commit()
    return row


# ─── The rule ─────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("amount", ["-384.92", "384.92"])
def test_a_transfer_is_neither_income_nor_spending_in_either_direction(amount):
    lookups = Lookups(account_types={1: "checking", 2: "credit_card"}, category_types={9: "transfer"})
    assert classify_values(Decimal(amount), 9, 1, lookups) == "transfer"
    assert classify_values(Decimal(amount), 9, 2, lookups) == "transfer"


def test_new_users_get_a_transfer_category(db_session, user):
    seed_user_categories(db_session, user.id)
    db_session.commit()

    kinds = {c.name: c.type for c in db_session.query(Category).filter_by(user_id=user.id)}
    assert kinds["Transfer"] == "transfer"


def test_a_transfer_category_can_be_created_but_not_budgeted(client, auth_headers):
    created = client.post("/categories/", json={"name": "Between accounts", "type": "transfer"}, headers=auth_headers)
    assert created.status_code == 201, created.text

    budget = client.post("/budgets/", json={"category_id": created.json()["id"], "amount": 100}, headers=auth_headers)
    assert budget.status_code in (400, 422)


# ─── Every server-side total leaves it out ────────────────────────────────────
def test_the_weekly_summary_does_not_count_a_card_payment_as_spending(db_session, user, account, transfer):
    today = user_today(user)
    dining = Category(user_id=user.id, name="Dining", type="expense")
    db_session.add(dining)
    db_session.commit()
    _tx(db_session, user, account, -40, today - timedelta(days=2), dining)
    _tx(db_session, user, account, -384.92, today - timedelta(days=3), transfer, "CAPITAL ONE ONLINE PMT")

    summary = weekly_summary.build_summary(db_session, user, today)

    assert summary.spent == Decimal("40")


def test_fin_monthly_flows_follow_the_app_rules(db_session, user, account, card, transfer):
    """Card payments, transfers and asset purchases used to land in income or spending by sign."""
    today = user_today(user)
    last_month = today.replace(day=1) - timedelta(days=10)
    gold = Category(user_id=user.id, name="Gold", type="investment")
    salary = Category(user_id=user.id, name="Salary", type="income")
    food = Category(user_id=user.id, name="Food", type="expense")
    db_session.add_all([gold, salary, food])
    db_session.commit()
    _tx(db_session, user, account, 3000, last_month, salary)                # income
    _tx(db_session, user, card, -200, last_month, food)                     # spending
    _tx(db_session, user, card, 50, last_month, food)                       # a refund
    _tx(db_session, user, card, 384.92, last_month)                         # card payment, card side
    _tx(db_session, user, account, -384.92, last_month, transfer)           # card payment, bank side
    _tx(db_session, user, account, -4099.99, last_month, gold)              # buying gold

    flows = tools._monthly_flows(db_session, user, months=1, today=today)

    assert flows[-1]["income"] == Decimal("3000")
    assert flows[-1]["spending"] == Decimal("150")
    trend = tools._t_cashflow_trend(db_session, user, months=2)
    assert trend[0]["income"] == 3000.0
    assert trend[0]["spending"] == 150.0


def test_fin_spending_by_category_leaves_transfers_and_purchases_out(db_session, user, account, transfer):
    today = user_today(user)
    food = Category(user_id=user.id, name="Food", type="expense")
    gold = Category(user_id=user.id, name="Gold", type="investment")
    db_session.add_all([food, gold])
    db_session.commit()
    _tx(db_session, user, account, -25, today, food)
    _tx(db_session, user, account, -10, today)
    _tx(db_session, user, account, -384.92, today, transfer)
    _tx(db_session, user, account, -8000, today, gold)

    rows = tools._t_spending_by_category(db_session, user)

    assert {r["category"]: r["total_spent"] for r in rows} == {"Food": 25.0, "Uncategorized": 10.0}


def test_a_monthly_card_payment_filed_as_a_transfer_is_not_suggested_as_a_bill(db_session, user, account, transfer):
    today = user_today(user)
    for months_ago in range(1, 5):
        _tx(db_session, user, account, -384.92, today - timedelta(days=30 * months_ago), transfer, "SCHWAB AUTOPAY")

    suggestions = recurring_detection.detect(db_session, user.id, today)

    assert [s.name for s in suggestions if "SCHWAB" in s.name.upper()] == []


# ─── Existing users get the category ──────────────────────────────────────────
def _run_migration(db_session, step: str) -> None:
    module = importlib.import_module("migrations.versions.20261110_000030_add_transfer_categories")
    connection = db_session.connection()
    context = MigrationContext.configure(connection)
    with Operations.context(context):
        getattr(module, step)()
    db_session.commit()


def test_the_migration_gives_each_user_one_transfer_category_and_is_safe_to_rerun(db_session, user, transfer):
    other = User(email="no-transfer@example.com", username="notransfer",
                 hashed_password=auth_utils.get_password_hash("Password123"), is_verified=True)
    db_session.add(other)
    db_session.commit()

    _run_migration(db_session, "upgrade")
    _run_migration(db_session, "upgrade")

    def count(user_id):
        return db_session.query(Category).filter_by(user_id=user_id, type="transfer").count()

    assert count(user.id) == 1   # already had one: left alone
    assert count(other.id) == 1  # had none: given one


def test_the_migration_downgrade_removes_only_what_it_added(db_session, user, account):
    _run_migration(db_session, "upgrade")
    added = db_session.query(Category).filter_by(user_id=user.id, type="transfer").one()
    payment = _tx(db_session, user, account, -100, date(2026, 11, 1), added)
    db_session.add(Category(user_id=user.id, name="Moves", type="transfer"))
    db_session.commit()

    _run_migration(db_session, "downgrade")

    names = [c.name for c in db_session.query(Category).filter_by(user_id=user.id, type="transfer")]
    assert names == ["Moves"]
    db_session.refresh(payment)
    assert payment.category_id is None
