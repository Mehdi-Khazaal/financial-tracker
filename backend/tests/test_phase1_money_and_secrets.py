"""Phase 1 correctness pins: money leaves as decimals, dates are the user's,
milestones announce once, stored secrets stay readable, tokens never log."""

import logging
from datetime import date, timedelta
from decimal import Decimal

import pytest

from models.database import Account, SavingsGoal, SavingsGoalAllocation, Transaction
from routers import plaid_router, savings_goals
from routers.savings_goals import milestone_reached
from services.balance_snapshots import refresh_snapshots_for_user
from utils.secret_box import decrypt_secret, encrypt_secret


# ─── History money as decimal strings ─────────────────────────────────────────
def test_history_endpoints_return_decimal_strings_not_floats(client, db_session, user, account, auth_headers):
    db_session.add(Transaction(
        user_id=user.id, account_id=account.id, amount=Decimal("-0.10"),
        description="x", transaction_date=date.today(),
    ))
    db_session.commit()

    net_worth = client.get("/history/net-worth?months=2", headers=auth_headers).json()
    single = client.get(f"/history/account/{account.id}?months=2", headers=auth_headers).json()
    all_accounts = client.get("/history/accounts?months=2", headers=auth_headers).json()

    for point in net_worth:
        assert isinstance(point["net_worth"], str) and Decimal(point["net_worth"]) == Decimal(point["net_worth"]).quantize(Decimal("0.01"))
        assert point["accounts"] == point["net_worth"]
    assert isinstance(single[-1]["balance"], str)
    assert Decimal(single[-1]["balance"]) == Decimal("1000.00")
    assert isinstance(all_accounts[str(account.id)][-1]["balance"], str)
    assert net_worth[-1]["net_worth"] == "1000.00"


def test_history_months_follow_the_users_calendar(client, db_session, user, account, auth_headers, monkeypatch):
    """A user in Auckland on the 1st is still in the previous month in UTC."""
    from routers import history as history_router

    user.timezone = "Pacific/Auckland"
    db_session.commit()
    monkeypatch.setattr(history_router, "user_today", lambda _user: date(2026, 3, 1))

    single = client.get(f"/history/account/{account.id}?months=1", headers=auth_headers).json()

    assert single[-1]["month"] == "2026-03"


# ─── Snapshots honour a caller-supplied day ───────────────────────────────────
def test_snapshot_refresh_uses_the_given_today(db_session, user, account):
    written = refresh_snapshots_for_user(db_session, user.id, months_back=1, include_today=True, today=date(2026, 2, 10))

    from models.database import AccountBalanceSnapshot
    dates = sorted(s.snapshot_date for s in db_session.query(AccountBalanceSnapshot).all())
    assert written == len(dates)
    assert date(2026, 2, 10) in dates
    assert date(2026, 2, 28) in dates
    assert all(d <= date(2026, 2, 28) for d in dates)


# ─── Milestones announce once per crossing ────────────────────────────────────
def test_milestone_reached_levels():
    assert milestone_reached(Decimal("0"), Decimal("100")) == 0
    assert milestone_reached(Decimal("49.99"), Decimal("100")) == 0
    assert milestone_reached(Decimal("50"), Decimal("100")) == 50
    assert milestone_reached(Decimal("75"), Decimal("100")) == 75
    assert milestone_reached(Decimal("120"), Decimal("100")) == 100
    assert milestone_reached(Decimal("10"), Decimal("0")) == 0


@pytest.fixture
def pushes(monkeypatch):
    sent = []
    monkeypatch.setattr(savings_goals, "send_push_to_user", lambda db, uid, title, body, **kw: sent.append((title, body)))
    return sent


def _set(client, headers, goal_id, account_id, amount):
    return client.put(
        f"/savings-goals/{goal_id}/allocations", headers=headers,
        json={"allocations": [{"account_id": account_id, "amount": amount}]},
    )


def test_milestone_push_fires_once_and_again_only_after_a_new_crossing(client, db_session, user, account, auth_headers, pushes):
    goal = SavingsGoal(user_id=user.id, name="Bike", target_amount=Decimal("100.00"))
    db_session.add(goal)
    db_session.commit()

    assert _set(client, auth_headers, goal.id, account.id, "60.00").status_code == 200
    assert [t for t, _ in pushes] == ["🎯 Bike"]
    assert _set(client, auth_headers, goal.id, account.id, "60.00").status_code == 200  # same level: silent
    assert _set(client, auth_headers, goal.id, account.id, "65.00").status_code == 200  # still 50 %: silent
    assert len(pushes) == 1

    _set(client, auth_headers, goal.id, account.id, "80.00")   # crosses 75 %
    _set(client, auth_headers, goal.id, account.id, "100.00")  # crosses 100 %
    assert [b for _, b in pushes] == ["You're 50% of the way there!", "You're 75% of the way there!", "Goal reached!"]

    _set(client, auth_headers, goal.id, account.id, "20.00")   # drops back: silent, resets
    assert len(pushes) == 3
    db_session.expire_all()
    assert db_session.get(SavingsGoal, goal.id).milestone_notified == 0
    _set(client, auth_headers, goal.id, account.id, "55.00")   # climbs past 50 % again
    assert len(pushes) == 4


# ─── Stored Plaid tokens stay readable across code changes ────────────────────
COMPAT_KEY = "fintrack-compat-test-key-2026"
COMPAT_PLAINTEXT = "access-sandbox-11111111-2222-3333-4444-555555555555"
# Produced by `encrypt_secret` on 2026-09-17 with COMPAT_KEY. If this stops
# decrypting, tokens already stored in production would stop decrypting too.
COMPAT_CIPHERTEXT = (
    "enc:v1:gAAAAABqrJGyipCBxg6_ubwNYU5-aVIIRlRDCKpRG0KxLzXybjWXJgzZOrpDLJA3DyE_ygI_mKULuEINOXFNvYdJoribRKhmVDLmwpM7lVNoYxOC4oU_dlQcj8gfjYKdgQ7pOhv_ZSm9zSQQ8eFF_ymmK4lPJSNpsA=="
)


def test_ciphertext_written_by_an_earlier_build_still_decrypts(monkeypatch):
    monkeypatch.setenv("PLAID_TOKEN_ENCRYPTION_KEY", COMPAT_KEY)
    assert decrypt_secret(COMPAT_CIPHERTEXT) == COMPAT_PLAINTEXT
    # And what we write today round-trips under the same key and prefix.
    fresh = encrypt_secret(COMPAT_PLAINTEXT)
    assert fresh.startswith("enc:v1:")
    assert decrypt_secret(fresh) == COMPAT_PLAINTEXT


def test_secret_key_fallback_is_used_only_when_no_dedicated_key(monkeypatch):
    monkeypatch.delenv("PLAID_TOKEN_ENCRYPTION_KEY", raising=False)
    monkeypatch.setenv("SECRET_KEY", "0123456789abcdef0123456789abcdef")
    token = encrypt_secret("access-production-abc")
    assert decrypt_secret(token) == "access-production-abc"
    monkeypatch.setenv("PLAID_TOKEN_ENCRYPTION_KEY", "a-different-key")
    with pytest.raises(RuntimeError):
        decrypt_secret(token)


# ─── Plaid credentials never reach logs or health columns ─────────────────────
def test_plaid_errors_are_scrubbed_before_logging_and_storing(monkeypatch, caplog):
    import requests

    def explode(url, json, timeout):
        raise requests.ConnectionError(f"boom for {json['access_token']} secret={json['secret']}")

    monkeypatch.setattr(plaid_router, "PLAID_SECRET", "super-secret-value")
    monkeypatch.setattr(plaid_router.requests, "post", explode)

    with caplog.at_level(logging.WARNING):
        with pytest.raises(Exception):
            plaid_router._plaid_post("/accounts/get", {"access_token": "access-sandbox-1234-abcd"})

    joined = " ".join(record.getMessage() for record in caplog.records)
    assert "access-sandbox-1234-abcd" not in joined
    assert "super-secret-value" not in joined
    assert "<redacted-plaid-token>" in joined

    stored = plaid_router._safe_error(RuntimeError("token access-production-zzz-999 leaked, public-sandbox-1 too"))
    assert "access-production-zzz-999" not in stored
    assert "public-sandbox-1" not in stored
