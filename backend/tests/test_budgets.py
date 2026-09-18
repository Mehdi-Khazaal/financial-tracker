"""Budgets: CRUD, ownership, month arithmetic, rollover, alerts, assistant tool."""

from datetime import date
from decimal import Decimal

import pytest

from models.auth import User
from models.database import Budget, Category, Transaction
from routers import assistant
from services import budgets as budget_service
from utils import auth as auth_utils


def _tx(db, user, account, category, amount, day):
    db.add(Transaction(user_id=user.id, account_id=account.id, category_id=category.id, amount=Decimal(amount), description="x", transaction_date=day))


@pytest.fixture
def groceries(db_session, user):
    row = Category(user_id=user.id, name="Groceries", type="expense", color="#f5a623")
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


# ─── CRUD and ownership ───────────────────────────────────────────────────────
def test_create_list_update_delete(client, db_session, user, auth_headers, groceries):
    created = client.post("/budgets/", headers=auth_headers, json={"category_id": groceries.id, "amount": "400", "rollover": True})
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["amount"] == "400.00" and body["rollover"] is True
    assert body["starts_on"].endswith("-01")

    listed = client.get("/budgets/", headers=auth_headers)
    assert listed.status_code == 200 and len(listed.json()) == 1
    assert listed.headers["etag"]
    assert client.get("/budgets/", headers={**auth_headers, "If-None-Match": listed.headers["etag"]}).status_code == 304

    updated = client.put(f"/budgets/{body['id']}", headers=auth_headers, json={"amount": "450.50", "rollover": False})
    assert updated.status_code == 200 and updated.json()["amount"] == "450.50" and updated.json()["rollover"] is False

    assert client.delete(f"/budgets/{body['id']}", headers=auth_headers).status_code == 204
    assert client.get("/budgets/", headers=auth_headers).json() == []


def test_one_budget_per_category_and_expense_only(client, db_session, user, auth_headers, groceries):
    income = Category(user_id=user.id, name="Salary", type="income", color="#2ecc8a")
    db_session.add(income)
    db_session.commit()

    assert client.post("/budgets/", headers=auth_headers, json={"category_id": groceries.id, "amount": "100"}).status_code == 201
    assert client.post("/budgets/", headers=auth_headers, json={"category_id": groceries.id, "amount": "200"}).status_code == 409
    assert client.post("/budgets/", headers=auth_headers, json={"category_id": income.id, "amount": "200"}).status_code == 400
    assert client.post("/budgets/", headers=auth_headers, json={"category_id": groceries.id, "amount": "0"}).status_code == 422


def test_another_users_category_and_budget_are_invisible(client, db_session, user, auth_headers, groceries):
    other = User(email="o@example.com", username="o", hashed_password=auth_utils.get_password_hash("Password123"))
    db_session.add(other)
    db_session.flush()
    theirs = Category(user_id=other.id, name="Theirs", type="expense", color="#111111")
    db_session.add(theirs)
    db_session.flush()
    their_budget = Budget(user_id=other.id, category_id=theirs.id, amount=Decimal("50"), starts_on=date(2026, 1, 1))
    db_session.add(their_budget)
    db_session.commit()

    assert client.post("/budgets/", headers=auth_headers, json={"category_id": theirs.id, "amount": "10"}).status_code == 404
    assert client.put(f"/budgets/{their_budget.id}", headers=auth_headers, json={"amount": "1"}).status_code == 404
    assert client.delete(f"/budgets/{their_budget.id}", headers=auth_headers).status_code == 404
    assert client.get("/budgets/", headers=auth_headers).json() == []
    assert client.get("/budgets/progress", headers=auth_headers).json()["budgets"] == []


# ─── Progress arithmetic ──────────────────────────────────────────────────────
def test_progress_nets_refunds_and_stays_within_the_month(client, db_session, user, account, auth_headers, groceries):
    db_session.add(Budget(user_id=user.id, category_id=groceries.id, amount=Decimal("300"), starts_on=date(2026, 6, 1)))
    _tx(db_session, user, account, groceries, "-120.00", date(2026, 6, 3))
    _tx(db_session, user, account, groceries, "-80.00", date(2026, 6, 20))
    _tx(db_session, user, account, groceries, "25.00", date(2026, 6, 21))   # refund
    _tx(db_session, user, account, groceries, "-999.00", date(2026, 5, 31))  # previous month
    _tx(db_session, user, account, groceries, "-999.00", date(2026, 7, 1))   # next month
    db_session.commit()

    response = client.get("/budgets/progress?month=2026-06", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["month"] == "2026-06"
    item = body["budgets"][0]
    assert item["spent"] == "175.00"
    assert item["available"] == "300.00"
    assert item["remaining"] == "125.00"
    assert item["percent"] == "58.3"
    assert item["over"] is False
    assert body["budgeted"] == "300.00" and body["spent"] == "175.00" and body["over_count"] == 0


def test_rollover_carries_unspent_but_never_overspend(client, db_session, user, account, auth_headers, groceries):
    db_session.add(Budget(user_id=user.id, category_id=groceries.id, amount=Decimal("100"), rollover=True, starts_on=date(2026, 3, 1)))
    _tx(db_session, user, account, groceries, "-40.00", date(2026, 3, 10))   # March: 60 left
    _tx(db_session, user, account, groceries, "-190.00", date(2026, 4, 10))  # April: 160 available, 30 over → carry 0
    _tx(db_session, user, account, groceries, "-20.00", date(2026, 5, 10))   # May: 100 available, 80 left
    db_session.commit()

    april = client.get("/budgets/progress?month=2026-04", headers=auth_headers).json()["budgets"][0]
    assert april["carried"] == "60.00" and april["available"] == "160.00" and april["over"] is True and april["remaining"] == "-30.00"

    june = client.get("/budgets/progress?month=2026-06", headers=auth_headers).json()["budgets"][0]
    assert june["carried"] == "80.00" and june["available"] == "180.00" and june["spent"] == "0.00"


def test_progress_defaults_to_the_users_own_month(client, db_session, user, account, auth_headers, groceries, monkeypatch):
    from routers import budgets as budgets_router

    monkeypatch.setattr(budgets_router, "user_today", lambda _user: date(2026, 2, 3))
    db_session.add(Budget(user_id=user.id, category_id=groceries.id, amount=Decimal("100"), starts_on=date(2026, 1, 1)))
    _tx(db_session, user, account, groceries, "-10.00", date(2026, 2, 1))
    db_session.commit()

    body = client.get("/budgets/progress", headers=auth_headers).json()
    assert body["month"] == "2026-02" and body["spent"] == "10.00"


def test_budget_that_starts_later_is_absent_from_earlier_months(client, db_session, user, auth_headers, groceries):
    db_session.add(Budget(user_id=user.id, category_id=groceries.id, amount=Decimal("100"), starts_on=date(2026, 8, 1)))
    db_session.commit()
    assert client.get("/budgets/progress?month=2026-07", headers=auth_headers).json()["budgets"] == []
    assert len(client.get("/budgets/progress?month=2026-08", headers=auth_headers).json()["budgets"]) == 1


def test_inactive_budgets_are_excluded_from_progress(client, db_session, user, auth_headers, groceries):
    row = Budget(user_id=user.id, category_id=groceries.id, amount=Decimal("100"), starts_on=date(2026, 1, 1))
    db_session.add(row)
    db_session.commit()
    client.put(f"/budgets/{row.id}", headers=auth_headers, json={"is_active": False})
    assert client.get("/budgets/progress?month=2026-06", headers=auth_headers).json()["budgets"] == []


# ─── Alerts ───────────────────────────────────────────────────────────────────
def test_over_budget_push_fires_once_per_month(client, db_session, user, account, auth_headers, groceries, monkeypatch):
    monkeypatch.setenv("CRON_SECRET", "s")
    today = date.today()
    db_session.add(Budget(user_id=user.id, category_id=groceries.id, amount=Decimal("100"), starts_on=today.replace(day=1)))
    _tx(db_session, user, account, groceries, "-150.00", today)
    db_session.commit()
    sent = []
    monkeypatch.setattr("routers.cron.send_push_to_user", lambda db, uid, title, body, **kw: sent.append((uid, title, body, kw["tag"])))

    first = client.post("/cron/check-budgets", headers={"X-Cron-Secret": "s"}).json()
    second = client.post("/cron/check-budgets", headers={"X-Cron-Secret": "s"}).json()

    assert first["alerts"] == 1 and second["alerts"] == 0
    assert sent[0][0] == user.id
    assert sent[0][1] == "Over budget: Groceries"
    assert "$150.00 of $100.00" in sent[0][2] and "$50.00 over" in sent[0][2]
    assert sent[0][3].startswith("budget-")
    db_session.expire_all()
    assert db_session.query(Budget).one().notified_month == f"{today.year:04d}-{today.month:02d}"


def test_under_budget_sends_nothing(client, db_session, user, account, auth_headers, groceries, monkeypatch):
    monkeypatch.setenv("CRON_SECRET", "s")
    today = date.today()
    db_session.add(Budget(user_id=user.id, category_id=groceries.id, amount=Decimal("100"), starts_on=today.replace(day=1)))
    _tx(db_session, user, account, groceries, "-50.00", today)
    db_session.commit()
    sent = []
    monkeypatch.setattr("routers.cron.send_push_to_user", lambda *a, **kw: sent.append(a))
    assert client.post("/cron/check-budgets", headers={"X-Cron-Secret": "s"}).json()["alerts"] == 0
    assert sent == []


# ─── Assistant ────────────────────────────────────────────────────────────────
def test_assistant_list_budgets_tool(db_session, user, account, groceries):
    today = date.today()
    db_session.add(Budget(user_id=user.id, category_id=groceries.id, amount=Decimal("200"), starts_on=today.replace(day=1)))
    _tx(db_session, user, account, groceries, "-50.00", today)
    db_session.commit()

    result = assistant.READ_TOOLS["list_budgets"](db_session, user)

    assert result["budgets"][0]["category"] == "Groceries"
    # Assistant payloads are JSON numbers (the model reads them); the API stays decimal strings.
    assert result["budgets"][0]["spent"] == 50.0
    assert result["budgets"][0]["remaining"] == 150.0
    assert result["budgets"][0]["over_budget"] is False
    assert "list_budgets" in assistant.QUICK_TOOL_NAMES
    assert any(schema["name"] == "list_budgets" for schema in assistant._tool_schemas())


def test_month_parsing():
    assert budget_service.parse_month("2026-02", date(2026, 9, 17)) == date(2026, 2, 1)
    assert budget_service.parse_month(None, date(2026, 9, 17)) == date(2026, 9, 1)
    with pytest.raises(ValueError):
        budget_service.parse_month("2026/02", date(2026, 9, 17))
