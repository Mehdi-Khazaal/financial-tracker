"""The paycheck plan: what each paycheck is for, ticked off as it happens.

Shaped on the live account: two employers (PHILIPS and Passavant) paying on the
same Friday every two weeks, bills declared as recurring, and four goals.
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from models.auth import User
from models.database import (
    Account, Category, PaycheckLine, RecurringTransaction, SavingsGoal, SavingsGoalAllocation, Transaction,
)
from routers.plaid_router import sync as plaid_sync
from services import paycheck_plan as service
from utils import auth as auth_utils
from utils.dates import user_today


@pytest.fixture
def today(user):
    return user_today(user)


@pytest.fixture
def last_payday(today):
    return today - timedelta(days=3)


@pytest.fixture
def salary(db_session, user):
    row = Category(user_id=user.id, name="Salary", type="income")
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def paychecks(db_session, user, account, salary, last_payday):
    """Six biweekly paydays, both employers on each, plus a one-off scholarship."""
    for n in range(6):
        on = last_payday - timedelta(days=14 * n)
        db_session.add(Transaction(user_id=user.id, account_id=account.id, category_id=salary.id,
                                   amount=Decimal("1835.29"), description="PHILIPS", merchant_key="philips",
                                   transaction_date=on))
        db_session.add(Transaction(user_id=user.id, account_id=account.id, category_id=salary.id,
                                   amount=Decimal("1187.06"), description="Passavant", merchant_key="passavant",
                                   transaction_date=on))
    db_session.add(Transaction(user_id=user.id, account_id=account.id, amount=Decimal("4385.50"),
                               description="Passavant Scholarship", merchant_key="passavant scholarship",
                               transaction_date=last_payday - timedelta(days=40)))
    db_session.commit()


@pytest.fixture
def home(db_session, user):
    row = Account(user_id=user.id, name="Home", type="cash", balance=Decimal("4910"), currency="USD")
    db_session.add(row)
    db_session.commit()
    return row


@pytest.fixture
def summer(db_session, user):
    row = SavingsGoal(user_id=user.id, name="Summer 2027", target_amount=Decimal("20000"))
    db_session.add(row)
    db_session.commit()
    return row


def _bill(db, user, account, name, amount, next_date, period="monthly", last_paid=None):
    db.add(RecurringTransaction(user_id=user.id, account_id=account.id, amount=Decimal(str(amount)),
                                description=name, period=period, next_date=next_date, is_active=True,
                                last_paid_date=last_paid))
    db.commit()


def _put(client, auth_headers, lines, sources=(("philips", "PHILIPS"), ("passavant", "Passavant")), notify=True):
    return client.put("/paycheck-plan", json={
        "sources": [{"merchant_key": k, "name": n} for k, n in sources],
        "lines": lines,
        "notify": notify,
    }, headers=auth_headers)


# ─── Finding pay ──────────────────────────────────────────────────────────────
def test_regular_payers_are_suggested_and_a_one_off_is_not(client, auth_headers, paychecks):
    body = client.get("/paycheck-plan", headers=auth_headers).json()

    assert body["configured"] is False
    names = {s["merchant_key"]: s for s in body["suggested_sources"]}
    assert set(names) == {"philips", "passavant"}
    assert names["philips"]["gap_days"] == 14
    assert Decimal(names["philips"]["typical_amount"]) == Decimal("1835.29")


def test_savings_interest_is_not_suggested_as_a_paycheck(client, db_session, user, auth_headers, second_account, paychecks, today):
    """The live account's $0.11 monthly interest was offered, and pre-ticked, as pay."""
    interest = Category(user_id=user.id, name="Interest", type="income")
    db_session.add(interest)
    db_session.commit()
    for n in range(5):
        db_session.add(Transaction(user_id=user.id, account_id=second_account.id, category_id=interest.id,
                                   amount=Decimal("0.11"), description="INTEREST PAYMENT", merchant_key="interest payment",
                                   transaction_date=today - timedelta(days=5 + 30 * n)))
    db_session.commit()

    body = client.get("/paycheck-plan", headers=auth_headers).json()

    assert {s["merchant_key"] for s in body["suggested_sources"]} == {"philips", "passavant"}


def test_same_day_deposits_are_one_payday(db_session, user, paychecks, today, last_payday):
    days = service.paydays(db_session, user.id, ["philips", "passavant"], today)

    assert days[-1].on == last_payday
    assert days[-1].amount == Decimal("3022.35")
    assert service.usual_gap_days(days) == 14
    assert service.paydays_per_month(14).quantize(Decimal("0.01")) == Decimal("2.17")


def test_too_little_history_assumes_two_weeks():
    assert service.usual_gap_days([]) == 14


# ─── The payday split ─────────────────────────────────────────────────────────
def test_the_latest_payday_is_split_into_bills_lines_and_free(
    client, db_session, user, auth_headers, account, home, summer, paychecks, today, last_payday,
):
    # Paid since payday, due before the next one, and one due after it.
    _bill(db_session, user, account, "Spotify", "-7.48", last_payday + timedelta(days=30), last_paid=last_payday + timedelta(days=1))
    _bill(db_session, user, account, "Planet Fitness", "-25.40", last_payday + timedelta(days=8))
    _bill(db_session, user, account, "Geico", "-75.17", last_payday + timedelta(days=20))

    response = _put(client, auth_headers, [{"goal_id": summer.id, "amount": 1500, "account_id": home.id}])

    assert response.status_code == 200, response.text
    latest = response.json()["latest"]
    assert latest["date"] == last_payday.isoformat()
    assert latest["next_payday"] == (last_payday + timedelta(days=14)).isoformat()
    assert Decimal(latest["amount"]) == Decimal("3022.35")
    assert [(b["name"], b["paid"]) for b in latest["bills"]] == [("Spotify", True), ("Planet Fitness", False)]
    assert Decimal(latest["bills_total"]) == Decimal("32.88")
    assert [(l["goal_name"], Decimal(l["amount"]), l["account_name"], l["done"]) for l in latest["lines"]] == [
        ("Summer 2027", Decimal("1500.00"), "Home", False),
    ]
    assert Decimal(latest["free"]) == Decimal("1489.47")


def test_a_weekly_bill_counts_every_time_it_falls_due(db_session, user, account, last_payday, today):
    _bill(db_session, user, account, "Laundry", "-10", last_payday + timedelta(days=1), period="weekly")

    bills = service.bills_between(db_session, user.id, last_payday, last_payday + timedelta(days=14), today)

    assert [b.on for b in bills] == [last_payday + timedelta(days=1), last_payday + timedelta(days=8)]


def test_the_plan_rejects_another_users_goal_a_repeated_goal_and_a_zero_amount(
    client, db_session, user, auth_headers, summer,
):
    stranger = User(email="stranger-plan@example.com", username="strangerplan",
                    hashed_password=auth_utils.get_password_hash("Password123"), is_verified=True)
    db_session.add(stranger)
    db_session.commit()
    theirs = SavingsGoal(user_id=stranger.id, name="Theirs", target_amount=Decimal("1"))
    db_session.add(theirs)
    db_session.commit()

    assert _put(client, auth_headers, [{"goal_id": theirs.id, "amount": 10}]).status_code == 400
    twice = [{"goal_id": summer.id, "amount": 10}, {"goal_id": summer.id, "amount": 20}]
    assert _put(client, auth_headers, twice).status_code == 400
    assert _put(client, auth_headers, [{"goal_id": summer.id, "amount": 0}]).status_code == 422


def test_saving_again_replaces_the_lines_and_sources(client, auth_headers, summer, home, paychecks):
    _put(client, auth_headers, [{"goal_id": summer.id, "amount": 1500, "account_id": home.id}])
    body = _put(client, auth_headers, [], sources=(("philips", "PHILIPS"),)).json()

    assert body["lines"] == []
    assert [s["merchant_key"] for s in body["sources"]] == ["philips"]
    assert Decimal(body["latest"]["amount"]) == Decimal("1835.29")


# ─── Ticking a line off ───────────────────────────────────────────────────────
def _line_id(client, auth_headers):
    return client.get("/paycheck-plan", headers=auth_headers).json()["lines"][0]["id"]


def test_ticking_sets_the_money_aside_and_untick_takes_it_back(
    client, db_session, user, auth_headers, home, summer, paychecks, last_payday,
):
    home.balance = Decimal("6410")  # the $1,500 has been moved in
    db_session.add(SavingsGoalAllocation(user_id=user.id, goal_id=summer.id, account_id=home.id, amount=Decimal("4910")))
    db_session.commit()
    _put(client, auth_headers, [{"goal_id": summer.id, "amount": 1500, "account_id": home.id}])
    line_id = _line_id(client, auth_headers)

    ticked = client.post("/paycheck-plan/ticks", json={"payday": last_payday.isoformat(), "line_id": line_id}, headers=auth_headers)
    again = client.post("/paycheck-plan/ticks", json={"payday": last_payday.isoformat(), "line_id": line_id}, headers=auth_headers)

    assert ticked.status_code == 200 and again.status_code == 200
    assert ticked.json()["latest"]["lines"][0]["done"] is True
    assert ticked.json()["latest"]["lines"][0]["set_aside"] is True
    db_session.expire_all()
    allocation = db_session.query(SavingsGoalAllocation).filter_by(goal_id=summer.id, account_id=home.id).one()
    assert allocation.amount == Decimal("6410.00")  # once, not twice

    undone = client.delete(f"/paycheck-plan/lines/{line_id}/ticks/{last_payday.isoformat()}", headers=auth_headers)

    assert undone.json()["latest"]["lines"][0]["done"] is False
    db_session.expire_all()
    assert db_session.query(SavingsGoalAllocation).filter_by(goal_id=summer.id).one().amount == Decimal("4910.00")


def test_setting_aside_money_that_is_not_there_says_so_and_done_only_still_works(
    client, db_session, user, auth_headers, home, summer, paychecks, last_payday,
):
    db_session.add(SavingsGoalAllocation(user_id=user.id, goal_id=summer.id, account_id=home.id, amount=Decimal("4910")))
    db_session.commit()
    _put(client, auth_headers, [{"goal_id": summer.id, "amount": 1500, "account_id": home.id}])
    line_id = _line_id(client, auth_headers)

    refused = client.post("/paycheck-plan/ticks", json={"payday": last_payday.isoformat(), "line_id": line_id}, headers=auth_headers)

    assert refused.status_code == 409
    assert refused.json()["detail"]["available"] == "0"
    assert "Home has $0.00 not set aside yet" in refused.json()["detail"]["message"]

    done_only = client.post("/paycheck-plan/ticks", json={"payday": last_payday.isoformat(), "line_id": line_id, "set_aside": False},
                            headers=auth_headers)
    assert done_only.json()["latest"]["lines"][0] == {**done_only.json()["latest"]["lines"][0], "done": True, "set_aside": False}
    db_session.expire_all()
    assert db_session.query(SavingsGoalAllocation).filter_by(goal_id=summer.id).one().amount == Decimal("4910.00")


def test_a_line_without_an_account_can_only_be_marked_done(client, auth_headers, summer, paychecks, last_payday):
    _put(client, auth_headers, [{"goal_id": summer.id, "amount": 100}])
    line_id = _line_id(client, auth_headers)

    response = client.post("/paycheck-plan/ticks", json={"payday": last_payday.isoformat(), "line_id": line_id}, headers=auth_headers)

    assert response.status_code == 400


def test_another_users_line_cannot_be_ticked(client, db_session, user, auth_headers, summer, last_payday):
    stranger = User(email="stranger-tick@example.com", username="strangertick",
                    hashed_password=auth_utils.get_password_hash("Password123"), is_verified=True)
    db_session.add(stranger)
    db_session.commit()
    plan = service.save_plan(db_session, stranger.id, sources=[], lines=[], notify=True)
    goal = SavingsGoal(user_id=stranger.id, name="Theirs", target_amount=Decimal("1"))
    db_session.add(goal)
    db_session.commit()
    line = PaycheckLine(user_id=stranger.id, plan_id=plan.id, goal_id=goal.id, amount=Decimal("5"))
    db_session.add(line)
    db_session.commit()

    response = client.post("/paycheck-plan/ticks", json={"payday": last_payday.isoformat(), "line_id": line.id}, headers=auth_headers)

    assert response.status_code == 404


def test_deleting_a_goal_removes_its_line(client, db_session, auth_headers, summer, paychecks):
    _put(client, auth_headers, [{"goal_id": summer.id, "amount": 100}])

    client.delete(f"/savings-goals/{summer.id}", headers=auth_headers)

    assert client.get("/paycheck-plan", headers=auth_headers).json()["lines"] == []


# ─── The payday push ──────────────────────────────────────────────────────────
@pytest.fixture
def pushes(monkeypatch):
    sent: list[tuple[str, str, str]] = []
    monkeypatch.setattr(plaid_sync, "send_push_to_user",
                        lambda db, user_id, title, body, url="/", tag="": sent.append((title, body, tag)))
    return sent


def test_a_new_paycheck_is_announced_once_with_the_split(
    client, db_session, user, auth_headers, account, home, summer, paychecks, last_payday, pushes,
):
    _bill(db_session, user, account, "Planet Fitness", "-25.40", last_payday + timedelta(days=8))
    _put(client, auth_headers, [{"goal_id": summer.id, "amount": 1500, "account_id": home.id}])

    assert plaid_sync._notify_payday(db_session, user.id) is True
    assert plaid_sync._notify_payday(db_session, user.id) is False

    title, body, tag = pushes[0]
    assert title == "Payday: $3,022.35 arrived"
    assert "Summer 2027 $1,500.00" in body
    assert body.endswith("Free: $1,496.95")
    assert tag == "payday"
    assert len(pushes) == 1


def test_no_push_when_notifications_are_off_or_the_payday_is_old(
    client, db_session, user, auth_headers, summer, paychecks, today, last_payday, pushes,
):
    _put(client, auth_headers, [], notify=False)
    assert plaid_sync._notify_payday(db_session, user.id) is False

    _put(client, auth_headers, [], notify=True)
    assert service.payday_to_announce(db_session, user.id, last_payday + timedelta(days=service.RECENT_DAYS + 1)) is None
    assert pushes == []


def test_no_plan_means_no_payday_push(db_session, user, paychecks, pushes):
    assert plaid_sync._notify_payday(db_session, user.id) is False
