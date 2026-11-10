"""Goals funded in priority order, each finishing when the money really reaches it.

The live account's four goals were each projected on the whole $783 a month as
if no other goal existed, and together needed $6,405.69 a month. Money is now
spent once: paycheck-plan lines first, then the surplus down the priority list.
"""

import importlib
from datetime import date, timedelta
from decimal import Decimal

from alembic.migration import MigrationContext
from alembic.operations import Operations

from models.auth import User
from models.database import SavingsGoal
from routers.assistant import tools
from services.goal_plan import GoalIn, months_until, plan
from utils import auth as auth_utils
from utils.dates import user_today

TODAY = date(2026, 11, 10)
D = Decimal


def _plan(goals, saving, committed=None):
    return {p.goal_id: p for p in plan(goals, monthly_saving=saving, committed=committed or {}, today=TODAY)}


def test_the_live_accounts_goals_need_6405_a_month_together():
    goals = [
        GoalIn(1, D("4500"), date(2026, 7, 1)),          # Emergency Funds, date passed
        GoalIn(2, D("15090"), date(2027, 6, 30)),        # Summer 2027
        GoalIn(3, D("5499.96"), date(2027, 1, 31)),      # Education
        GoalIn(4, D("1500"), date(2026, 12, 31)),        # Trip
    ]
    result = _plan(goals, D("783"))

    needed = sum((p.needed_monthly or D("0")) for p in result.values())
    assert needed == D("6405.69")
    assert result[1].status == "date-passed"


def test_money_goes_down_the_list_in_order():
    goals = [GoalIn(1, D("1000"), None), GoalIn(2, D("1000"), None)]

    first = _plan(goals, D("500"))
    swapped = _plan(list(reversed(goals)), D("500"))

    # Top goal in two months, the next two months after it.
    assert (first[1].months_to_finish, first[2].months_to_finish) == (2, 4)
    assert (swapped[2].months_to_finish, swapped[1].months_to_finish) == (2, 4)


def test_leftover_in_a_month_flows_to_the_next_goal():
    goals = [GoalIn(1, D("300"), None), GoalIn(2, D("1000"), None)]
    result = _plan(goals, D("500"))
    # Month 1: 300 to the first, 200 to the second. Then 500 a month.
    assert (result[1].months_to_finish, result[2].months_to_finish) == (1, 3)


def test_a_paycheck_line_funds_its_goal_first_and_the_rest_flows():
    goals = [GoalIn(1, D("1000"), None), GoalIn(2, D("3000"), None)]
    # 1,000 a month kept; the plan sends 600 of it to goal 2 every month.
    result = _plan(goals, D("1000"), {2: D("600")})
    # Goal 1 gets the other 400 a month and is done in month 3, when only 200
    # is left to find; the spare 200 that month flows on to goal 2, which then
    # finishes in month 4 instead of 5.
    assert result[1].months_to_finish == 3
    assert result[2].months_to_finish == 4


def test_on_time_and_late_are_measured_against_the_finish_month():
    goals = [GoalIn(1, D("1000"), date(2027, 1, 31)), GoalIn(2, D("1000"), date(2027, 1, 31))]
    result = _plan(goals, D("500"))

    assert result[1].status == "on-time"
    assert result[2].status == "late"
    assert result[2].late_by_months == 2


def test_no_saving_and_no_plan_means_no_judgement():
    result = _plan([GoalIn(1, D("1000"), date(2027, 6, 1))], D("0"))
    assert result[1].status == "unknown"
    assert result[1].months_to_finish is None


def test_beyond_ten_years_is_never():
    result = _plan([GoalIn(1, D("1000000"), None)], D("100"))
    assert result[1].status == "never"


def test_a_funded_goal_is_complete_and_releases_its_line():
    goals = [GoalIn(1, D("0"), None), GoalIn(2, D("1000"), None)]
    result = _plan(goals, D("0"), {1: D("500")})
    assert result[1].status == "complete"
    assert result[2].months_to_finish == 2


def test_months_until_counts_like_the_screens():
    assert months_until(date(2026, 12, 31), TODAY) == 1
    assert months_until(date(2027, 6, 30), TODAY) == 7
    assert months_until(date(2026, 12, 5), TODAY) == 0


# ─── Order API ────────────────────────────────────────────────────────────────
def _goal(client, auth_headers, name, deadline=None):
    body = {"name": name, "target_amount": 1000}
    if deadline:
        body["deadline"] = deadline
    return client.post("/savings-goals/", json=body, headers=auth_headers).json()


def test_new_goals_join_the_end_and_can_be_reordered(client, auth_headers):
    trip = _goal(client, auth_headers, "Trip")
    summer = _goal(client, auth_headers, "Summer 2027")
    assert (trip["priority"], summer["priority"]) == (1, 2)

    reordered = client.put("/savings-goals/order", json={"goal_ids": [summer["id"], trip["id"]]}, headers=auth_headers)

    assert reordered.status_code == 200
    assert [g["name"] for g in reordered.json()] == ["Summer 2027", "Trip"]
    listed = client.get("/savings-goals/", headers=auth_headers).json()
    assert [(g["name"], g["priority"]) for g in listed] == [("Summer 2027", 1), ("Trip", 2)]


def test_the_order_must_name_every_goal_once_and_only_mine(client, db_session, auth_headers):
    trip = _goal(client, auth_headers, "Trip")
    summer = _goal(client, auth_headers, "Summer 2027")
    stranger = User(email="stranger-order@example.com", username="strangerorder",
                    hashed_password=auth_utils.get_password_hash("Password123"), is_verified=True)
    db_session.add(stranger)
    db_session.commit()
    theirs = SavingsGoal(user_id=stranger.id, name="Theirs", target_amount=D("1"))
    db_session.add(theirs)
    db_session.commit()

    for ids in ([trip["id"]], [trip["id"], trip["id"]], [trip["id"], summer["id"], theirs.id]):
        assert client.put("/savings-goals/order", json={"goal_ids": ids}, headers=auth_headers).status_code == 400


def test_the_migration_orders_existing_goals_by_deadline(db_session, user):
    later = SavingsGoal(user_id=user.id, name="Summer", target_amount=D("1"), deadline=date(2027, 6, 30))
    undated = SavingsGoal(user_id=user.id, name="Someday", target_amount=D("1"))
    sooner = SavingsGoal(user_id=user.id, name="Trip", target_amount=D("1"), deadline=date(2026, 12, 31))
    db_session.add_all([later, undated, sooner])
    db_session.commit()

    module = importlib.import_module("migrations.versions.20261110_000034_add_goal_priority")
    with Operations.context(MigrationContext.configure(db_session.connection())):
        module.upgrade()
    db_session.commit()
    db_session.expire_all()

    order = sorted(db_session.query(SavingsGoal).filter_by(user_id=user.id), key=lambda g: g.priority)
    assert [g.name for g in order] == ["Trip", "Summer", "Someday"]


# ─── Fin ──────────────────────────────────────────────────────────────────────
def test_fin_reports_the_same_plan(db_session, user, account):
    today = user_today(user)
    first = SavingsGoal(user_id=user.id, name="First", target_amount=D("1000"), priority=1,
                        deadline=today + timedelta(days=400))
    second = SavingsGoal(user_id=user.id, name="Second", target_amount=D("1000"), priority=2)
    db_session.add_all([second, first])
    db_session.commit()

    result = tools._t_project_savings_goals(db_session, user)

    assert [g["name"] for g in result] == ["First", "Second"]
    assert [g["priority"] for g in result] == [1, 2]
    # No history: no surplus and no paycheck plan to judge by.
    assert result[0]["plan_status"] == "unknown"
