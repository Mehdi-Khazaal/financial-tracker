"""Goal money is not available to spend, and only the emergency fund is cover.

The live account showed "Available to spend $5,603.28" while $4,910 of it was
a cash account set aside entirely for a summer trip; the real figure was
$693.28. Its emergency fund read "1.7 months" from $9,603.32 of cash, $8,910.04
of which was promised to goals.
"""

import importlib
from datetime import timedelta
from decimal import Decimal

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations

from models.auth import User
from models.database import Account, Category, SavingsGoal, SavingsGoalAllocation, Transaction
from routers.assistant import tools
from services.cash_position import cash_position
from utils import auth as auth_utils
from utils.dates import user_today


def _account(db, user, name, kind, balance):
    row = Account(user_id=user.id, name=name, type=kind, balance=Decimal(str(balance)), currency="USD")
    db.add(row)
    db.commit()
    return row


def _goal(db, user, name, allocations, emergency=False):
    goal = SavingsGoal(user_id=user.id, name=name, target_amount=Decimal("1000"), is_emergency_fund=emergency)
    db.add(goal)
    db.commit()
    for account, amount in allocations:
        db.add(SavingsGoalAllocation(user_id=user.id, goal_id=goal.id, account_id=account.id, amount=Decimal(str(amount))))
    db.commit()
    return goal


@pytest.fixture
def live_shape(db_session, user):
    """The live account: three cash accounts and four goals."""
    spend = _account(db_session, user, "Spend", "checking", "693.28")
    reserve = _account(db_session, user, "Reserve", "savings", "4000.04")
    home = _account(db_session, user, "Home", "cash", "4910.00")
    _account(db_session, user, "VentureOne", "credit_card", "-384.92")
    _goal(db_session, user, "Emergency Funds", [(reserve, "500")], emergency=True)
    _goal(db_session, user, "Summer 2027", [(home, "4910")])
    _goal(db_session, user, "Education", [(reserve, "2500.04")])
    _goal(db_session, user, "Trip", [(reserve, "1000")])
    return spend, reserve, home


def test_goal_money_is_not_available_to_spend(db_session, user, live_shape):
    cash = cash_position(db_session, user.id)

    assert cash.liquid == Decimal("9603.32")
    assert cash.set_aside == Decimal("8910.04")
    assert cash.available_to_spend == Decimal("693.28")


def test_only_free_money_and_the_emergency_fund_are_cover(db_session, user, live_shape):
    # 693.28 free in Spend, plus the 500 emergency fund in Reserve.
    assert cash_position(db_session, user.id).emergency_cash == Decimal("1193.28")


def test_an_over_allocated_account_frees_nothing_and_takes_nothing_from_others(db_session, user):
    spend = _account(db_session, user, "Spend", "checking", "300")
    home = _account(db_session, user, "Home", "cash", "100")
    _goal(db_session, user, "Trip", [(home, "250")])

    cash = cash_position(db_session, user.id)

    assert cash.available_to_spend == Decimal("300")
    assert cash.emergency_cash == Decimal("300")
    del spend


def test_an_overdraft_still_counts_against_you(db_session, user):
    _account(db_session, user, "Spend", "checking", "-40")
    _account(db_session, user, "Home", "cash", "100")

    assert cash_position(db_session, user.id).available_to_spend == Decimal("60")


def test_another_users_goals_never_touch_my_figures(db_session, user):
    spend = _account(db_session, user, "Spend", "checking", "500")
    stranger = User(email="stranger-cash@example.com", username="strangercash",
                    hashed_password=auth_utils.get_password_hash("Password123"), is_verified=True)
    db_session.add(stranger)
    db_session.commit()
    goal = SavingsGoal(user_id=stranger.id, name="Theirs", target_amount=Decimal("1"))
    db_session.add(goal)
    db_session.commit()
    # A row pointing at my account but owned by someone else must be ignored.
    db_session.add(SavingsGoalAllocation(user_id=stranger.id, goal_id=goal.id, account_id=spend.id, amount=Decimal("400")))
    db_session.commit()

    assert cash_position(db_session, user.id).available_to_spend == Decimal("500")


# ─── The flag ─────────────────────────────────────────────────────────────────
def test_a_goal_can_be_created_and_edited_as_the_emergency_fund(client, auth_headers):
    created = client.post("/savings-goals/", json={"name": "Rainy day", "target_amount": 3000, "is_emergency_fund": True},
                          headers=auth_headers)
    assert created.status_code == 201, created.text
    assert created.json()["is_emergency_fund"] is True

    goal_id = created.json()["id"]
    updated = client.put(f"/savings-goals/{goal_id}", json={"is_emergency_fund": False}, headers=auth_headers)
    assert updated.json()["is_emergency_fund"] is False


def test_the_migration_marks_goals_named_for_emergencies(db_session, user):
    rainy = SavingsGoal(user_id=user.id, name="Emergency Funds", target_amount=Decimal("5000"))
    trip = SavingsGoal(user_id=user.id, name="Trip", target_amount=Decimal("2500"))
    db_session.add_all([rainy, trip])
    db_session.commit()

    module = importlib.import_module("migrations.versions.20261110_000031_add_goal_emergency_fund")
    with Operations.context(MigrationContext.configure(db_session.connection())):
        module.upgrade()
    db_session.commit()
    db_session.expire_all()

    assert db_session.get(SavingsGoal, rainy.id).is_emergency_fund is True
    assert db_session.get(SavingsGoal, trip.id).is_emergency_fund is False


# ─── Fin ──────────────────────────────────────────────────────────────────────
def test_fin_measures_cover_with_the_same_emergency_cash(db_session, user, live_shape):
    spend, _, _ = live_shape
    today = user_today(user)
    food = Category(user_id=user.id, name="Food", type="expense")
    db_session.add(food)
    db_session.commit()
    last_month = today.replace(day=1) - timedelta(days=5)
    db_session.add(Transaction(user_id=user.id, account_id=spend.id, amount=Decimal("-1193.28"),
                               category_id=food.id, description="Food", transaction_date=last_month))
    db_session.commit()

    health = tools._t_financial_health(db_session, user)
    overview = tools._t_get_overview(db_session, user)

    assert health["emergency_cash"] == 1193.28
    assert health["emergency_fund_months"] == 1.0
    assert overview["available_to_spend"] == 693.28
    assert overview["set_aside_for_goals"] == 8910.04
