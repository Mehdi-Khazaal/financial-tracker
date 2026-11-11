"""Big one-offs, left out of a usual month.

Shaped on the live ledger: a $7,000 motorcycle, a $3,050 car repair, tuition
twice ($2,055 and $8,455), rent-like charges every month, gold bought with
savings, and moves between accounts.
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from models.database import Category, SavingsGoal, Transaction
from routers import assistant
from services.classification import load_lookups
from services.one_offs import one_offs


@pytest.fixture
def kinds(db_session, user):
    rows = {
        "expense": Category(user_id=user.id, name="Shopping", type="expense"),
        "income": Category(user_id=user.id, name="Salary", type="income"),
        "transfer": Category(user_id=user.id, name="Transfer", type="transfer"),
        "investment": Category(user_id=user.id, name="Gold", type="investment"),
    }
    db_session.add_all(rows.values())
    db_session.commit()
    return rows


def _spend(db, user, account, amount, on, description, category, one_off=None):
    row = Transaction(user_id=user.id, account_id=account.id, category_id=category.id, amount=Decimal(str(amount)),
                      description=description, merchant_key=description.lower(), transaction_date=on, one_off=one_off)
    db.add(row)
    db.commit()
    return row


def test_large_charges_that_do_not_repeat_are_one_offs(db_session, user, account, kinds):
    shop = kinds["expense"]
    motorcycle = _spend(db_session, user, account, -7000, date(2026, 6, 27), "Withdrawal", shop)
    repair = _spend(db_session, user, account, -3050, date(2026, 4, 11), "Pulat Auto", shop)
    tuition_summer = _spend(db_session, user, account, -2055, date(2026, 5, 20), "PSU Tuition", shop)
    tuition_fall = _spend(db_session, user, account, -8455, date(2026, 8, 29), "PSU Tuition", shop)
    rent = [_spend(db_session, user, account, -1500, date(2026, m, 1), "Landlord", shop) for m in (6, 7, 8)]
    small = _spend(db_session, user, account, -999, date(2026, 7, 3), "Costco", shop)

    found = one_offs(db_session.query(Transaction).all(), load_lookups(db_session, user.id))

    assert set(found) == {motorcycle.id, repair.id, tuition_summer.id, tuition_fall.id}
    assert found[tuition_fall.id] == Decimal("8455")
    assert not any(r.id in found for r in rent)
    assert small.id not in found


def test_money_that_is_not_spending_is_never_a_one_off(db_session, user, account, kinds):
    gold = _spend(db_session, user, account, -8000, date(2026, 10, 14), "2 Ounce Gold", kinds["investment"])
    move = _spend(db_session, user, account, -1750, date(2026, 9, 28), "To Home", kinds["transfer"])
    scholarship = _spend(db_session, user, account, 4385.5, date(2026, 5, 30), "Scholarship", kinds["income"])

    found = one_offs(db_session.query(Transaction).all(), load_lookups(db_session, user.id))

    assert not {gold.id, move.id, scholarship.id} & set(found)


def test_the_users_mark_overrides_the_rule_both_ways(db_session, user, account, kinds):
    shop = kinds["expense"]
    flight = _spend(db_session, user, account, -640, date(2026, 10, 19), "Turkish Airlines", shop, one_off=True)
    routine_big = _spend(db_session, user, account, -7000, date(2026, 6, 27), "Withdrawal", shop, one_off=False)

    found = one_offs(db_session.query(Transaction).all(), load_lookups(db_session, user.id))

    assert found == {flight.id: Decimal("640")}
    assert routine_big.id not in found


def test_a_transaction_can_be_marked_and_handed_back_to_the_rule(client, auth_headers, db_session, user, account, kinds):
    row = _spend(db_session, user, account, -7000, date(2026, 6, 27), "Withdrawal", kinds["expense"])

    marked = client.put(f"/transactions/{row.id}", json={"one_off": False}, headers=auth_headers)
    assert marked.status_code == 200, marked.text
    assert marked.json()["one_off"] is False

    automatic = client.put(f"/transactions/{row.id}", json={"one_off": None}, headers=auth_headers)
    assert automatic.json()["one_off"] is None
    db_session.refresh(account)
    assert account.balance == Decimal("1000")


def test_fin_funds_goals_from_a_usual_month(db_session, user, account, kinds):
    """Four months keeping $1,000, one of them with a $7,000 motorcycle."""
    anchor = assistant._month_floor(assistant._user_today(user))
    for offset in range(1, 5):
        month = assistant._add_months(anchor, -offset)
        _spend(db_session, user, account, 4000, month, "Employer", kinds["income"])
        _spend(db_session, user, account, -3000, month + timedelta(days=5), "Everything", kinds["expense"])
    _spend(db_session, user, account, -7000, assistant._add_months(anchor, -2) + timedelta(days=9), "Withdrawal", kinds["expense"])
    db_session.add(SavingsGoal(user_id=user.id, name="Summer 2027", target_amount=Decimal("20000")))
    db_session.commit()

    projected = assistant._t_project_savings_goals(db_session, user)[0]

    # Plainly averaged, the motorcycle turns $1,000 a month into -$750.
    assert projected["avg_monthly_surplus"] == 1000.0
    assert projected["one_off_spending_monthly"] == 1750.0
