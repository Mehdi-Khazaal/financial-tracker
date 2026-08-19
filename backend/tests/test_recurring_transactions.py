"""Recurring schedule validation, advancement and materialization.

The bug these guard against: `RecurringTransactionUpdate.period` used to accept
any string, and `_next_date` returned the date unchanged for anything it did
not recognise. A single malformed PATCH therefore left a row permanently due,
and every `process-due` call re-created its transaction and re-applied its
amount to the account balance.
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from models.database import Account, RecurringTransaction, Transaction
from services.recurring_schedule import (
    UnsupportedPeriodError,
    next_occurrence,
    occurrences_per_year,
)


ALL_PERIODS = ["weekly", "biweekly", "monthly", "quarterly", "yearly"]


# ─── Pure schedule arithmetic ─────────────────────────────────────────────────
@pytest.mark.parametrize(
    "period,start,expected",
    [
        ("weekly", date(2026, 3, 2), date(2026, 3, 9)),
        ("biweekly", date(2026, 3, 2), date(2026, 3, 16)),
        ("monthly", date(2026, 3, 2), date(2026, 4, 2)),
        ("quarterly", date(2026, 3, 2), date(2026, 6, 2)),
        ("yearly", date(2026, 3, 2), date(2027, 3, 2)),
    ],
)
def test_next_occurrence_advances_each_period(period, start, expected):
    assert next_occurrence(start, period) == expected


@pytest.mark.parametrize("period", ALL_PERIODS)
def test_next_occurrence_always_moves_forward(period):
    start = date(2026, 1, 31)
    assert next_occurrence(start, period) > start


def test_monthly_clamps_to_short_month():
    # Jan 31 has no counterpart in February.
    assert next_occurrence(date(2026, 1, 31), "monthly") == date(2026, 2, 28)


def test_monthly_crosses_year_boundary():
    assert next_occurrence(date(2026, 12, 15), "monthly") == date(2027, 1, 15)


def test_quarterly_crosses_year_boundary():
    assert next_occurrence(date(2026, 11, 10), "quarterly") == date(2027, 2, 10)


def test_yearly_clamps_leap_day():
    # 2028 is a leap year, 2027 is not.
    assert next_occurrence(date(2028, 2, 29), "yearly") == date(2029, 2, 28)


@pytest.mark.parametrize("bad", ["daily", "fortnightly", "", "MONTHLY", None, 7])
def test_next_occurrence_rejects_unknown_period(bad):
    with pytest.raises(UnsupportedPeriodError):
        next_occurrence(date(2026, 3, 2), bad)


def test_occurrences_per_year_rejects_daily():
    # "daily" was carried in a private lookup in the assistant; it is not a
    # cadence the scheduler can materialize, so it must not annualise either.
    with pytest.raises(UnsupportedPeriodError):
        occurrences_per_year("daily")


# ─── Schema validation ────────────────────────────────────────────────────────
def _create_payload(account_id, **overrides):
    payload = {
        "account_id": account_id,
        "amount": -15.99,
        "description": "Streamflix",
        "period": "monthly",
        "next_date": "2026-03-02",
    }
    payload.update(overrides)
    return payload


@pytest.mark.parametrize("period", ALL_PERIODS)
def test_create_accepts_every_valid_period(client, auth_headers, account, period):
    response = client.post(
        "/recurring/",
        json=_create_payload(account.id, period=period),
        headers=auth_headers,
    )
    assert response.status_code == 201, response.text
    assert response.json()["period"] == period


@pytest.mark.parametrize("bad", ["daily", "fortnightly", "MONTHLY", "", "monthly "])
def test_create_rejects_invalid_period(client, auth_headers, account, bad):
    response = client.post(
        "/recurring/",
        json=_create_payload(account.id, period=bad),
        headers=auth_headers,
    )
    assert response.status_code == 422


@pytest.mark.parametrize("period", ALL_PERIODS)
def test_patch_accepts_every_valid_period(client, auth_headers, account, period):
    created = client.post(
        "/recurring/", json=_create_payload(account.id), headers=auth_headers
    ).json()
    response = client.patch(
        f"/recurring/{created['id']}", json={"period": period}, headers=auth_headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["period"] == period


@pytest.mark.parametrize("bad", ["daily", "fortnightly", "MONTHLY", "", "nonsense"])
def test_patch_rejects_invalid_period(client, auth_headers, account, bad):
    """The regression this whole module exists for."""
    created = client.post(
        "/recurring/", json=_create_payload(account.id), headers=auth_headers
    ).json()
    response = client.patch(
        f"/recurring/{created['id']}", json={"period": bad}, headers=auth_headers
    )
    assert response.status_code == 422
    # And the stored period is untouched.
    listed = client.get("/recurring/", headers=auth_headers).json()
    assert listed[0]["period"] == "monthly"


# ─── process-due ──────────────────────────────────────────────────────────────
def _seed_recurring(db_session, user, account, **overrides):
    values = {
        "user_id": user.id,
        "account_id": account.id,
        "category_id": None,
        "amount": Decimal("-20.00"),
        "description": "Gym",
        "period": "monthly",
        "next_date": date.today() - timedelta(days=1),
        "is_active": True,
        "is_variable": False,
    }
    values.update(overrides)
    rec = RecurringTransaction(**values)
    db_session.add(rec)
    db_session.commit()
    db_session.refresh(rec)
    return rec


def test_process_due_creates_and_advances(client, db_session, user, auth_headers, account):
    rec = _seed_recurring(db_session, user, account)
    due_date = rec.next_date
    opening = Decimal(str(account.balance))

    response = client.post("/recurring/process-due", headers=auth_headers)
    assert response.status_code == 200
    assert len(response.json()) == 1

    db_session.expire_all()
    refreshed = db_session.get(RecurringTransaction, rec.id)
    assert refreshed.next_date == next_occurrence(due_date, "monthly")

    acct = db_session.get(Account, account.id)
    assert Decimal(str(acct.balance)) == opening + Decimal("-20.00")


def test_process_due_is_not_repeatable_within_a_cycle(client, db_session, user, auth_headers, account):
    _seed_recurring(db_session, user, account)

    first = client.post("/recurring/process-due", headers=auth_headers)
    second = client.post("/recurring/process-due", headers=auth_headers)

    assert len(first.json()) == 1
    assert second.json() == []  # already advanced past today

    db_session.expire_all()
    assert db_session.query(Transaction).filter(Transaction.user_id == user.id).count() == 1


def test_invalid_period_row_is_skipped_not_materialized(client, db_session, user, auth_headers, account):
    """A row that cannot advance must produce nothing at all.

    Before the fix this created a transaction and moved the balance on *every*
    call, because `next_date` never advanced past today.
    """
    _seed_recurring(db_session, user, account, period="daily")
    opening = Decimal(str(account.balance))

    for _ in range(3):
        response = client.post("/recurring/process-due", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []

    db_session.expire_all()
    assert db_session.query(Transaction).filter(Transaction.user_id == user.id).count() == 0
    acct = db_session.get(Account, account.id)
    assert Decimal(str(acct.balance)) == opening


def test_process_due_skips_variable_rows(client, db_session, user, auth_headers, account):
    _seed_recurring(db_session, user, account, is_variable=True)
    response = client.post("/recurring/process-due", headers=auth_headers)
    assert response.json() == []


def test_process_due_skips_inactive_rows(client, db_session, user, auth_headers, account):
    _seed_recurring(db_session, user, account, is_active=False)
    response = client.post("/recurring/process-due", headers=auth_headers)
    assert response.json() == []


def test_process_due_ignores_future_rows(client, db_session, user, auth_headers, account):
    _seed_recurring(db_session, user, account, next_date=date.today() + timedelta(days=10))
    response = client.post("/recurring/process-due", headers=auth_headers)
    assert response.json() == []


# ─── Variable logging ─────────────────────────────────────────────────────────
def test_log_variable_records_actual_amount_and_advances(
    client, db_session, user, auth_headers, account
):
    rec = _seed_recurring(
        db_session, user, account, is_variable=True, amount=Decimal("-60.00"), description="Power bill"
    )
    due_date = rec.next_date
    opening = Decimal(str(account.balance))

    response = client.post(
        f"/recurring/{rec.id}/log", json={"amount": -73.40}, headers=auth_headers
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert Decimal(str(body["amount"])) == Decimal("-73.40")
    # Charge is dated to the cycle being logged, not the advanced date.
    assert body["transaction_date"] == due_date.isoformat()

    db_session.expire_all()
    refreshed = db_session.get(RecurringTransaction, rec.id)
    assert refreshed.next_date == next_occurrence(due_date, "monthly")
    # The logged amount becomes next cycle's estimate.
    assert Decimal(str(refreshed.amount)) == Decimal("-73.40")

    acct = db_session.get(Account, account.id)
    assert Decimal(str(acct.balance)) == opening + Decimal("-73.40")


def test_log_variable_honours_explicit_date(client, db_session, user, auth_headers, account):
    rec = _seed_recurring(db_session, user, account, is_variable=True)
    response = client.post(
        f"/recurring/{rec.id}/log",
        json={"amount": -12.00, "transaction_date": "2026-02-14"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["transaction_date"] == "2026-02-14"


def test_log_variable_on_invalid_period_writes_nothing(
    client, db_session, user, auth_headers, account
):
    """422 before any partial write — no transaction, no balance movement."""
    rec = _seed_recurring(db_session, user, account, is_variable=True, period="daily")
    opening = Decimal(str(account.balance))

    response = client.post(
        f"/recurring/{rec.id}/log", json={"amount": -30.00}, headers=auth_headers
    )
    assert response.status_code == 422

    db_session.expire_all()
    assert db_session.query(Transaction).filter(Transaction.user_id == user.id).count() == 0
    acct = db_session.get(Account, account.id)
    assert Decimal(str(acct.balance)) == opening


# ─── Tenant isolation ─────────────────────────────────────────────────────────
def test_cannot_patch_another_users_recurring(client, db_session, user, auth_headers, account):
    from models.auth import User
    from utils import auth as auth_utils

    other = User(
        email="other@example.com",
        username="other",
        hashed_password=auth_utils.get_password_hash("Password123"),
        is_verified=True,
    )
    db_session.add(other)
    db_session.commit()
    other_account = Account(user_id=other.id, name="Theirs", type="checking", balance=0)
    db_session.add(other_account)
    db_session.commit()
    rec = RecurringTransaction(
        user_id=other.id,
        account_id=other_account.id,
        amount=Decimal("-5"),
        description="Theirs",
        period="monthly",
        next_date=date.today(),
        is_active=True,
        is_variable=False,
    )
    db_session.add(rec)
    db_session.commit()

    response = client.patch(
        f"/recurring/{rec.id}", json={"period": "weekly"}, headers=auth_headers
    )
    assert response.status_code == 404


# ─── Nightly cron path ────────────────────────────────────────────────────────
# `/cron/process-recurring` is a *second* materialization path, running
# unattended for every user. It carried its own copy of the period arithmetic
# with the same silent `return current` fallback, so these mirror the
# process-due guarantees for the job nobody is watching.
CRON_SECRET = "cron-test-secret"


def _cron(client, monkeypatch):
    monkeypatch.setenv("CRON_SECRET", CRON_SECRET)
    return client.post("/cron/process-recurring", headers={"X-Cron-Secret": CRON_SECRET})


def test_cron_requires_the_secret(client, monkeypatch):
    monkeypatch.setenv("CRON_SECRET", CRON_SECRET)
    assert client.post("/cron/process-recurring").status_code == 403
    assert client.post(
        "/cron/process-recurring", headers={"X-Cron-Secret": "wrong"}
    ).status_code == 403


def test_cron_creates_and_advances(client, db_session, user, account, monkeypatch):
    rec = _seed_recurring(db_session, user, account)
    due_date = rec.next_date
    opening = Decimal(str(account.balance))

    response = _cron(client, monkeypatch)
    assert response.status_code == 200
    assert response.json()["processed"] == 1

    db_session.expire_all()
    assert db_session.get(RecurringTransaction, rec.id).next_date == next_occurrence(due_date, "monthly")
    assert Decimal(str(db_session.get(Account, account.id).balance)) == opening + Decimal("-20.00")


def test_cron_invalid_period_never_materializes(client, db_session, user, account, monkeypatch):
    """The live bug: this job ran nightly and re-created the same transaction
    every single time, because `next_date` never advanced past today."""
    _seed_recurring(db_session, user, account, period="daily")
    opening = Decimal(str(account.balance))

    for _ in range(3):
        response = _cron(client, monkeypatch)
        assert response.status_code == 200
        assert response.json()["processed"] == 0
        assert response.json()["skipped_unsupported_period"] == 1

    db_session.expire_all()
    assert db_session.query(Transaction).filter(Transaction.user_id == user.id).count() == 0
    assert Decimal(str(db_session.get(Account, account.id).balance)) == opening


def test_cron_is_not_repeatable_within_a_cycle(client, db_session, user, account, monkeypatch):
    _seed_recurring(db_session, user, account)

    first = _cron(client, monkeypatch)
    second = _cron(client, monkeypatch)

    assert first.json()["processed"] == 1
    assert second.json()["processed"] == 0
    db_session.expire_all()
    assert db_session.query(Transaction).filter(Transaction.user_id == user.id).count() == 1


def test_cron_skips_variable_and_inactive_rows(client, db_session, user, account, monkeypatch):
    _seed_recurring(db_session, user, account, is_variable=True)
    _seed_recurring(db_session, user, account, is_active=False)
    assert _cron(client, monkeypatch).json()["processed"] == 0


def test_cron_respects_the_users_own_calendar_day(client, db_session, user, account, monkeypatch):
    """A row due tomorrow must not fire early for a user behind UTC.

    The candidate query deliberately over-selects by a day; the per-user filter
    is what keeps that from materializing early.
    """
    user.timezone = "Pacific/Honolulu"  # UTC-10
    db_session.commit()
    _seed_recurring(db_session, user, account, next_date=date.today() + timedelta(days=1))

    assert _cron(client, monkeypatch).json()["processed"] == 0
    db_session.expire_all()
    assert db_session.query(Transaction).filter(Transaction.user_id == user.id).count() == 0
