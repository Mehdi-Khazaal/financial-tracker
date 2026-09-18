"""Public-launch controls: signup policy, verification gate, assistant caps,
admin usage, data export and self-serve deletion."""

import csv
import io
import json
from datetime import date
from decimal import Decimal

import pytest

from models.auth import AuthFailure, User
from models.database import Account, AssistantUsageDaily, Transaction
from models.push import PushSubscription
from routers import plaid_router
from routers.plaid_router.models import PlaidItem
from services import assistant_usage
from utils import auth as auth_utils
from utils.limiter import limiter
from utils.secret_box import encrypt_secret

SIGNUP = {"email": "new@example.com", "username": "newbie", "password": "Password123"}


# ─── Signup policy ────────────────────────────────────────────────────────────
def test_signups_can_be_closed(client, monkeypatch):
    monkeypatch.setenv("SIGNUPS_ENABLED", "false")
    assert client.get("/auth/signup-policy").json() == {"open": False, "invite_required": False}
    assert client.post("/auth/signup", json=SIGNUP).status_code == 403


def test_invite_code_is_required_when_configured(client, monkeypatch):
    monkeypatch.delenv("SIGNUPS_ENABLED", raising=False)
    monkeypatch.setenv("SIGNUP_INVITE_CODE", "beta-2026")
    assert client.get("/auth/signup-policy").json() == {"open": True, "invite_required": True}

    assert client.post("/auth/signup", json=SIGNUP).status_code == 403
    limiter.reset()
    assert client.post("/auth/signup", json={**SIGNUP, "invite_code": "wrong"}).status_code == 403
    limiter.reset()
    assert client.post("/auth/signup", json={**SIGNUP, "invite_code": " beta-2026 "}).status_code == 201


def test_signup_is_open_by_default(client, monkeypatch):
    monkeypatch.delenv("SIGNUPS_ENABLED", raising=False)
    monkeypatch.delenv("SIGNUP_INVITE_CODE", raising=False)
    assert client.get("/auth/signup-policy").json() == {"open": True, "invite_required": False}
    assert client.post("/auth/signup", json=SIGNUP).status_code == 201


# ─── Email verification gate ──────────────────────────────────────────────────
@pytest.fixture
def unverified(db_session):
    row = User(email="u@example.com", username="unv", hashed_password=auth_utils.get_password_hash("Password123"), is_verified=False)
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row, {"Authorization": f"Bearer {auth_utils.create_access_token({'sub': str(row.id)})}"}


def test_unverified_users_are_blocked_only_when_enforcement_is_on(client, unverified, monkeypatch):
    _, headers = unverified
    monkeypatch.delenv("REQUIRE_EMAIL_VERIFICATION", raising=False)
    assert client.get("/accounts/", headers=headers).status_code == 200

    monkeypatch.setenv("REQUIRE_EMAIL_VERIFICATION", "true")
    blocked = client.get("/accounts/", headers=headers)
    assert blocked.status_code == 403
    assert blocked.json()["detail"]["code"] == "email_unverified"
    # The routes that let them fix it stay open.
    assert client.get("/auth/me", headers=headers).status_code == 200
    assert client.post("/auth/logout", headers=headers).status_code == 200


def test_resend_verification_sends_for_unverified_only(client, unverified, user, auth_headers, monkeypatch):
    sent = []
    monkeypatch.setattr("routers.auth.send_verification", lambda email, token: sent.append(email))
    _, headers = unverified

    assert client.post("/auth/resend-verification", headers=headers).status_code == 200
    assert client.post("/auth/resend-verification", headers=auth_headers).json()["message"] == "Email is already verified."
    assert sent == ["u@example.com"]


# ─── Assistant caps ───────────────────────────────────────────────────────────
def test_turn_cap_blocks_before_the_model_is_called(client, db_session, user, auth_headers, monkeypatch):
    monkeypatch.setenv("ASSISTANT_DAILY_TURN_CAP", "2")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    for _ in range(2):
        assistant_usage.record_turn(db_session, user, Decimal("0.01"))

    called = []
    monkeypatch.setitem(__import__("sys").modules, "anthropic", type("M", (), {"Anthropic": lambda **k: called.append(1)}))
    response = client.post("/assistant/chat", headers=auth_headers, json={"message": "hi"})

    assert response.status_code == 429
    assert "limit" in response.json()["detail"].lower()
    assert called == []


def test_cost_cap_blocks_and_zero_disables(client, db_session, user, auth_headers, monkeypatch):
    monkeypatch.setenv("ASSISTANT_DAILY_COST_CAP_USD", "0.05")
    assistant_usage.record_turn(db_session, user, Decimal("0.06"))
    assert client.post("/assistant/chat", headers=auth_headers, json={"message": "hi"}).status_code == 429

    monkeypatch.setenv("ASSISTANT_DAILY_COST_CAP_USD", "0")
    monkeypatch.setenv("ASSISTANT_DAILY_TURN_CAP", "0")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    # Caps off: the next gate is the missing API key, proving we got past them.
    assert client.post("/assistant/chat", headers=auth_headers, json={"message": "hi"}).status_code == 503


def test_usage_rows_are_per_user_per_day(db_session, user):
    assistant_usage.record_turn(db_session, user, Decimal("0.001234"))
    assistant_usage.record_turn(db_session, user, Decimal("0.002"))
    row = db_session.query(AssistantUsageDaily).one()
    assert row.turns == 2
    assert Decimal(str(row.cost_usd)) == Decimal("0.003234")
    today = assistant_usage.usage_today(db_session, user)
    assert today["turns"] == 2 and today["cost_usd"] == Decimal("0.003234")


def test_admin_usage_view_is_admin_only_and_summarises(client, db_session, user, auth_headers):
    assistant_usage.record_turn(db_session, user, Decimal("0.5"))
    assert client.get("/admin/usage", headers=auth_headers).status_code == 403

    user.is_admin = True
    db_session.commit()
    response = client.get("/admin/usage?days=7", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["days"] == 7
    assert body["users"][0]["username"] == user.username
    assert body["users"][0]["turns"] == 1
    assert Decimal(body["users"][0]["cost_usd"]) == Decimal("0.5")


# ─── Export ───────────────────────────────────────────────────────────────────
def test_export_json_contains_everything_and_only_mine(client, db_session, user, account, category, auth_headers):
    db_session.add(Transaction(user_id=user.id, account_id=account.id, category_id=category.id, amount=Decimal("-12.34"), description="Mine", transaction_date=date(2026, 6, 1)))
    other = User(email="o@example.com", username="o", hashed_password="x")
    db_session.add(other)
    db_session.flush()
    db_session.add(Account(user_id=other.id, name="THEIRS", type="checking", balance=Decimal("9")))
    db_session.commit()

    response = client.get("/account/export", headers=auth_headers)

    assert response.status_code == 200
    assert response.headers["content-disposition"].startswith("attachment;")
    body = json.loads(response.content)
    assert body["export_version"] == 1
    assert body["user"]["email"] == user.email
    assert [a["name"] for a in body["accounts"]] == ["Primary Checking"]
    assert body["transactions"][0]["amount"] == "-12.34"  # money stays a decimal string
    assert "THEIRS" not in response.text


def test_export_csv_is_spreadsheet_safe(client, db_session, user, account, auth_headers):
    db_session.add(Transaction(user_id=user.id, account_id=account.id, amount=Decimal("-5.00"), description="=HYPERLINK(evil)", transaction_date=date(2026, 6, 1)))
    db_session.commit()

    response = client.get("/account/export/transactions.csv", headers=auth_headers)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    rows = list(csv.reader(io.StringIO(response.text.lstrip("﻿"))))
    assert rows[0] == ["date", "account", "category", "amount", "description", "merchant", "source"]
    assert rows[1][3] == "-5.00" and rows[1][4] == "'=HYPERLINK(evil)" and rows[1][6] == "manual"


# ─── Deletion ─────────────────────────────────────────────────────────────────
def test_delete_requires_password_and_confirmation(client, db_session, user, auth_headers):
    assert client.post("/account/delete", headers=auth_headers, json={"password": "Password123", "confirmation": "nope"}).status_code == 400
    limiter.reset()
    assert client.post("/account/delete", headers=auth_headers, json={"password": "wrong", "confirmation": "DELETE"}).status_code == 403
    assert db_session.get(User, user.id) is not None


def test_delete_removes_plaid_items_push_and_every_row(client, db_session, user, account, auth_headers, monkeypatch):
    db_session.add_all([
        Transaction(user_id=user.id, account_id=account.id, amount=Decimal("-1"), description="x", transaction_date=date(2026, 6, 1)),
        PushSubscription(user_id=user.id, endpoint="https://push.example.com/me", p256dh="k", auth="a"),
        PlaidItem(user_id=user.id, access_token=encrypt_secret("access-sandbox-1"), item_id="item-1", institution_name="Bank"),
        AuthFailure(identifier=user.email, failures=2),
    ])
    db_session.commit()
    removed = []
    monkeypatch.setattr(plaid_router, "_plaid_post", lambda path, body: removed.append(path) or {})

    uid = user.id
    response = client.post("/account/delete", headers=auth_headers, json={"password": "Password123", "confirmation": "delete"})

    assert response.status_code == 200, response.text
    assert response.json() == {"deleted": True, "bank_connections_removed": 1, "bank_connections_unremoved": 0}
    assert removed == ["/item/remove"]
    assert "access_token=" in response.headers.get("set-cookie", "")  # cookies cleared
    db_session.expunge_all()
    assert db_session.query(User).filter(User.id == uid).first() is None
    assert db_session.query(Account).count() == 0
    assert db_session.query(Transaction).count() == 0
    assert db_session.query(PushSubscription).count() == 0
    assert db_session.query(PlaidItem).count() == 0
    assert db_session.query(AuthFailure).count() == 0


def test_delete_still_completes_when_plaid_is_down(client, db_session, user, auth_headers, monkeypatch):
    db_session.add(PlaidItem(user_id=user.id, access_token=encrypt_secret("access-sandbox-1"), item_id="item-1", institution_name="Bank"))
    db_session.commit()

    def boom(path, body):
        raise RuntimeError("plaid unreachable")

    monkeypatch.setattr(plaid_router, "_plaid_post", boom)
    uid = user.id
    response = client.post("/account/delete", headers=auth_headers, json={"password": "Password123", "confirmation": "DELETE"})

    assert response.status_code == 200
    assert response.json()["bank_connections_unremoved"] == 1
    db_session.expunge_all()
    assert db_session.query(User).filter(User.id == uid).first() is None
