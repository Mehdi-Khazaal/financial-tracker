"""Alert preferences and the pushes they gate: bills, budgets, low balance."""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from models.auth import User
from models.database import Account, Budget, Category, RecurringTransaction, Transaction, UserPreferences
from routers import cron, plaid_router
from services import alerts, budgets as budget_service, recurring_bills, user_preferences
from utils import auth as auth_utils
from utils.dates import user_today


class Recorder:
    def __init__(self):
        self.sent = []

    def __call__(self, db, user_id, title, body, url="/", tag="fintrack"):
        self.sent.append({"user_id": user_id, "title": title, "body": body, "url": url, "tag": tag})


# ─── Preferences ──────────────────────────────────────────────────────────────
def test_defaults_preserve_current_behaviour(client, auth_headers):
    body = client.get("/preferences", headers=auth_headers).json()
    assert body["bill_reminders_enabled"] is True
    assert body["budget_alerts_enabled"] is True
    assert body["low_balance_alerts_enabled"] is False
    assert body["low_balance_threshold"] == "100.00"


def test_threshold_is_stored_as_decimal_and_validated(client, auth_headers, db_session, user):
    res = client.patch("/preferences", headers=auth_headers, json={"low_balance_alerts_enabled": True, "low_balance_threshold": "250.5"})
    assert res.status_code == 200, res.text
    assert res.json()["low_balance_threshold"] == "250.50"
    assert res.json()["low_balance_alerts_enabled"] is True
    row = db_session.query(UserPreferences).filter_by(user_id=user.id).one()
    assert Decimal(str(row.low_balance_threshold)) == Decimal("250.50")
    assert client.patch("/preferences", headers=auth_headers, json={"low_balance_threshold": "-1"}).status_code == 422
    assert client.patch("/preferences", headers=auth_headers, json={"low_balance_threshold": "abc"}).status_code == 422


# ─── Bill reminders ───────────────────────────────────────────────────────────
def _bill(db, user, account, days_ahead):
    rec = RecurringTransaction(
        user_id=user.id, account_id=account.id, amount=Decimal("-50.00"), description="Rent",
        period="monthly", next_date=user_today(user) + timedelta(days=days_ahead), is_active=True, is_variable=False,
    )
    db.add(rec)
    db.commit()
    return rec


def test_bill_reminders_are_skipped_and_not_marked_when_off(client, db_session, user, account, monkeypatch):
    monkeypatch.setenv("CRON_SECRET", "s")
    recorder = Recorder()
    monkeypatch.setattr(cron, "send_push_to_user", recorder)
    rec = _bill(db_session, user, account, days_ahead=2)
    user_preferences.upsert(db_session, user.id, {"bill_reminders_enabled": False})
    db_session.commit()

    res = client.post("/cron/process-recurring", headers={"X-Cron-Secret": "s"})
    assert res.status_code == 200 and res.json()["alerts"] == 0
    assert recorder.sent == []
    db_session.refresh(rec)
    assert rec.reminder_sent_for is None  # nothing marked: switching on resumes

    user_preferences.upsert(db_session, user.id, {"bill_reminders_enabled": True})
    db_session.commit()
    res = client.post("/cron/process-recurring", headers={"X-Cron-Secret": "s"})
    assert res.json()["alerts"] == 1
    assert recorder.sent[0]["title"] == "Rent is due in 2 days"


# ─── Budget alerts ────────────────────────────────────────────────────────────
def test_budget_alerts_are_skipped_and_not_marked_when_off(db_session, user, account):
    groceries = Category(user_id=user.id, name="Groceries", type="expense", color="#fff")
    db_session.add(groceries)
    db_session.commit()
    today = user_today(user)
    db_session.add(Budget(user_id=user.id, category_id=groceries.id, amount=Decimal("100"), starts_on=today.replace(day=1)))
    db_session.add(Transaction(user_id=user.id, account_id=account.id, category_id=groceries.id, amount=Decimal("-150"), description="x", transaction_date=today))
    user_preferences.upsert(db_session, user.id, {"budget_alerts_enabled": False})
    db_session.commit()

    recorder = Recorder()
    assert budget_service.notify_over_budget(db_session, user, recorder) == 0
    assert db_session.query(Budget).one().notified_month is None

    user_preferences.upsert(db_session, user.id, {"budget_alerts_enabled": True})
    db_session.commit()
    assert budget_service.notify_over_budget(db_session, user, recorder) == 1
    assert recorder.sent[0]["tag"].startswith("budget-")


# ─── Low balance ──────────────────────────────────────────────────────────────
@pytest.fixture
def low_balance_on(db_session, user):
    user_preferences.upsert(db_session, user.id, {"low_balance_alerts_enabled": True, "low_balance_threshold": Decimal("100")})
    db_session.commit()


def test_low_balance_fires_once_per_dip_and_rearms_on_recovery(db_session, user, account, low_balance_on):
    recorder = Recorder()
    account.balance = Decimal("40.00")
    db_session.commit()

    assert alerts.check_low_balances(db_session, user, recorder) == 1
    assert recorder.sent[0]["title"] == f"Low balance: {account.name}"
    assert "$40.00 left, below your $100.00 threshold" in recorder.sent[0]["body"]
    assert recorder.sent[0]["tag"] == f"low-balance-{account.id}"
    assert account.low_balance_notified_on == user_today(user)

    # Still low the next night: silence.
    assert alerts.check_low_balances(db_session, user, recorder) == 0

    # Recovered: re-armed, nothing sent.
    account.balance = Decimal("500.00")
    db_session.commit()
    assert alerts.check_low_balances(db_session, user, recorder) == 0
    assert account.low_balance_notified_on is None

    # Dips again: announced again.
    account.balance = Decimal("-20.00")
    db_session.commit()
    assert alerts.check_low_balances(db_session, user, recorder) == 1
    assert recorder.sent[1]["body"] == "Overdrawn by $20.00."


def test_low_balance_respects_threshold_and_account_type(db_session, user, low_balance_on):
    recorder = Recorder()
    checking = Account(user_id=user.id, name="Checking", type="checking", balance=Decimal("100.00"))  # at threshold: fine
    card = Account(user_id=user.id, name="Card", type="credit_card", balance=Decimal("-900.00"))
    invest = Account(user_id=user.id, name="Brokerage", type="investment", balance=Decimal("5.00"))
    cash = Account(user_id=user.id, name="Wallet", type="cash", balance=Decimal("99.99"))
    db_session.add_all([checking, card, invest, cash])
    db_session.commit()
    assert alerts.check_low_balances(db_session, user, recorder) == 1
    assert recorder.sent[0]["title"] == "Low balance: Wallet"


def test_low_balance_off_sends_nothing_and_marks_nothing(db_session, user, account):
    recorder = Recorder()
    account.balance = Decimal("1.00")
    db_session.commit()
    assert alerts.check_low_balances(db_session, user, recorder) == 0
    assert account.low_balance_notified_on is None
    # Switching on later announces what is currently low.
    user_preferences.upsert(db_session, user.id, {"low_balance_alerts_enabled": True})
    db_session.commit()
    assert alerts.check_low_balances(db_session, user, recorder) == 1


def test_cron_check_balances_covers_only_opted_in_users(client, db_session, user, account, low_balance_on, monkeypatch):
    monkeypatch.setenv("CRON_SECRET", "s")
    recorder = Recorder()
    monkeypatch.setattr(cron, "send_push_to_user", recorder)
    other = User(email="o@example.com", username="o", hashed_password=auth_utils.get_password_hash("Password123"))
    db_session.add(other)
    db_session.commit()
    db_session.add(Account(user_id=other.id, name="Theirs", type="checking", balance=Decimal("0")))
    account.balance = Decimal("10.00")
    db_session.commit()

    assert client.post("/cron/check-balances").status_code == 403
    res = client.post("/cron/check-balances", headers={"X-Cron-Secret": "s"})
    assert res.status_code == 200
    assert res.json() == {"users": 1, "alerts": 1}
    assert {s["user_id"] for s in recorder.sent} == {user.id}


def test_sync_hook_runs_the_low_balance_check(db_session, user, account, low_balance_on, monkeypatch):
    recorder = Recorder()
    monkeypatch.setattr(plaid_router.sync, "send_push_to_user", recorder)
    account.balance = Decimal("5.00")
    db_session.commit()
    plaid_router.sync._notify_balances(db_session, user.id)
    assert [s["tag"] for s in recorder.sent] == [f"low-balance-{account.id}"]
