"""Two-factor authentication: TOTP maths, enrolment, login step-up, recovery, lockout."""

import base64
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from models.auth import AuthFailure, RecoveryCode, User
from services import two_factor
from utils import auth as auth_utils
from utils import totp
from utils.limiter import limiter
from utils.secret_box import encrypt_secret

NOW = 1_800_000_000.0  # a fixed instant, well inside one 30 s step


@pytest.fixture(autouse=True)
def frozen_clock(monkeypatch):
    clock = {"t": NOW}
    monkeypatch.setattr(totp, "_now", lambda: clock["t"])
    limiter.reset()
    return clock


def _enrolled(db_session, user):
    secret = totp.new_secret()
    user.totp_secret = encrypt_secret(secret)
    user.totp_enabled = True
    db_session.commit()
    return secret


def _login(client, identifier="user@example.com", password="Password123"):
    return client.post("/auth/login", json={"identifier": identifier, "password": password})


# ─── TOTP (RFC 6238 SHA-1 vectors, truncated to six digits) ───────────────────
def test_rfc6238_vectors():
    secret = base64.b32encode(b"12345678901234567890").decode()
    for t, expected in ((59, "287082"), (1111111109, "081804"), (1234567890, "005924"), (2000000000, "279037")):
        assert totp.code_for_step(secret, totp.step_at(t)) == expected


def test_verify_window_replay_and_format():
    secret = totp.new_secret()
    step = totp.step_at(NOW)
    assert totp.verify(secret, totp.code_for_step(secret, step), timestamp=NOW) == step
    assert totp.verify(secret, totp.code_for_step(secret, step - 1), timestamp=NOW) == step - 1  # phone a bit slow
    assert totp.verify(secret, totp.code_for_step(secret, step - 2), timestamp=NOW) is None
    assert totp.verify(secret, totp.code_for_step(secret, step), timestamp=NOW, last_step=step) is None  # replay
    spaced = totp.code_for_step(secret, step)
    assert totp.verify(secret, f"{spaced[:3]} {spaced[3:]}", timestamp=NOW) == step
    assert totp.verify(secret, "12345a", timestamp=NOW) is None
    assert totp.provisioning_uri(secret, "a@b.co").startswith("otpauth://totp/Fintrack%3Aa%40b.co?secret=")


# ─── Enrolment ────────────────────────────────────────────────────────────────
def test_enrolment_needs_the_password_and_a_working_code(client, db_session, user, auth_headers):
    assert client.post("/auth/2fa/setup", headers=auth_headers, json={"password": "nope"}).status_code == 403
    setup = client.post("/auth/2fa/setup", headers=auth_headers, json={"password": "Password123"})
    assert setup.status_code == 200, setup.text
    body = setup.json()
    assert body["qr_svg"].startswith("data:image/svg+xml;base64,")
    assert "Fintrack" in body["otpauth_uri"]
    secret = body["secret"].replace(" ", "")
    db_session.refresh(user)
    assert user.totp_pending_secret.startswith("enc:v1:") and not user.totp_enabled

    assert client.post("/auth/2fa/enable", headers=auth_headers, json={"code": "000000"}).status_code == 400
    code = totp.code_for_step(secret, totp.step_at(NOW))
    enabled = client.post("/auth/2fa/enable", headers=auth_headers, json={"code": code})
    assert enabled.status_code == 200, enabled.text
    codes = enabled.json()["recovery_codes"]
    assert len(codes) == 10 and len(set(codes)) == 10
    assert "access_token=" in enabled.headers.get("set-cookie", "")

    db_session.expire_all()
    stored = db_session.get(User, user.id)
    assert stored.totp_enabled and stored.totp_pending_secret is None and stored.totp_secret.startswith("enc:v1:")
    assert all(len(row.code_hash) == 64 for row in db_session.query(RecoveryCode).all())
    # This browser got a fresh session; every other one (the old token) is out.
    assert client.get("/auth/me").status_code == 200
    client.cookies.clear()
    assert client.get("/auth/me", headers=auth_headers).status_code == 401


def test_status_and_me_report_the_state(client, db_session, user, auth_headers):
    assert client.get("/auth/2fa", headers=auth_headers).json() == {"enabled": False, "recovery_codes_remaining": 0}
    assert client.get("/auth/me", headers=auth_headers).json()["two_factor_enabled"] is False
    _enrolled(db_session, user)
    two_factor.issue_recovery_codes(db_session, user)
    db_session.commit()
    assert client.get("/auth/2fa", headers=auth_headers).json() == {"enabled": True, "recovery_codes_remaining": 10}
    assert client.get("/auth/me", headers=auth_headers).json()["two_factor_enabled"] is True


# ─── Login step-up ────────────────────────────────────────────────────────────
def test_password_alone_no_longer_signs_in(client, db_session, user):
    secret = _enrolled(db_session, user)
    first = _login(client)
    assert first.status_code == 200
    assert first.json()["two_factor_required"] is True
    assert "access_token=" not in first.headers.get("set-cookie", "")
    challenge = first.json()["challenge"]

    assert client.post("/auth/login/2fa", json={"challenge": challenge, "code": "000000"}).status_code == 401
    code = totp.code_for_step(secret, totp.step_at(NOW))
    ok = client.post("/auth/login/2fa", json={"challenge": challenge, "code": code})
    assert ok.status_code == 200, ok.text
    assert "access_token=" in ok.headers.get("set-cookie", "")
    assert db_session.query(AuthFailure).count() == 0  # both counters cleared

    # The same code cannot be used again, even inside its window.
    again = client.post("/auth/login/2fa", json={"challenge": _login(client).json()["challenge"], "code": code})
    assert again.status_code == 401


def test_recovery_codes_work_once_and_can_be_replaced(client, db_session, user, auth_headers):
    _enrolled(db_session, user)
    codes = two_factor.issue_recovery_codes(db_session, user)
    db_session.commit()

    used = client.post("/auth/login/2fa", json={"challenge": _login(client).json()["challenge"], "code": codes[0].upper()})
    assert used.status_code == 200 and used.json()["recovery_codes_remaining"] == 9
    assert client.post("/auth/login/2fa", json={"challenge": _login(client).json()["challenge"], "code": codes[0]}).status_code == 401

    fresh = client.post("/auth/2fa/recovery-codes", headers=auth_headers, json={"password": "Password123"})
    assert fresh.status_code == 200
    assert client.post("/auth/login/2fa", json={"challenge": _login(client).json()["challenge"], "code": codes[1]}).status_code == 401
    assert client.post("/auth/login/2fa", json={"challenge": _login(client).json()["challenge"], "code": fresh.json()["recovery_codes"][0]}).status_code == 200


def test_challenges_expire_and_die_with_a_password_change(client, db_session, user, frozen_clock):
    secret = _enrolled(db_session, user)
    assert client.post("/auth/login/2fa", json={"challenge": "garbage", "code": "123456"}).status_code == 401
    challenge = _login(client).json()["challenge"]
    user.session_version = (user.session_version or 0) + 1  # e.g. a password reset
    db_session.commit()
    code = totp.code_for_step(secret, totp.step_at(NOW))
    assert client.post("/auth/login/2fa", json={"challenge": challenge, "code": code}).status_code == 401
    # An access token is not a challenge.
    access = auth_utils.create_access_token({"sub": str(user.id), "sv": user.session_version})
    assert client.post("/auth/login/2fa", json={"challenge": access, "code": code}).status_code == 401
    # And a challenge is only good for five minutes.
    expired = jwt.encode(
        {"sub": str(user.id), "sv": user.session_version, "type": two_factor.CHALLENGE_TYPE, "exp": datetime.now(timezone.utc) - timedelta(seconds=1)},
        auth_utils.SECRET_KEY, algorithm=auth_utils.ALGORITHM,
    )
    assert client.post("/auth/login/2fa", json={"challenge": expired, "code": code}).status_code == 401


def test_guessing_codes_locks_out_like_guessing_passwords(client, db_session, user):
    secret = _enrolled(db_session, user)
    challenge = _login(client).json()["challenge"]
    for _ in range(5):
        assert client.post("/auth/login/2fa", json={"challenge": challenge, "code": "000000"}).status_code == 401
    limiter.reset()
    right = totp.code_for_step(secret, totp.step_at(NOW))
    locked = client.post("/auth/login/2fa", json={"challenge": challenge, "code": right})
    assert locked.status_code == 429 and "Retry-After" in locked.headers


# ─── Turning it off ───────────────────────────────────────────────────────────
def test_disable_needs_password_and_code(client, db_session, user, auth_headers, frozen_clock):
    secret = _enrolled(db_session, user)
    two_factor.issue_recovery_codes(db_session, user)
    db_session.commit()
    assert client.post("/auth/2fa/disable", headers=auth_headers, json={"password": "nope", "code": "000000"}).status_code == 403
    assert client.post("/auth/2fa/disable", headers=auth_headers, json={"password": "Password123", "code": "000000"}).status_code == 400
    code = totp.code_for_step(secret, totp.step_at(NOW))
    off = client.post("/auth/2fa/disable", headers=auth_headers, json={"password": "Password123", "code": code})
    assert off.status_code == 200 and off.json()["enabled"] is False
    db_session.expire_all()
    assert db_session.get(User, user.id).totp_secret is None
    assert db_session.query(RecoveryCode).count() == 0
    assert "access_token=" in _login(client).headers.get("set-cookie", "")


def test_admin_can_turn_it_off_for_a_locked_out_user(client, db_session, user, auth_headers):
    _enrolled(db_session, user)
    admin = User(email="admin@example.com", username="admin", hashed_password=auth_utils.get_password_hash("Password123"), is_admin=True)
    db_session.add(admin)
    db_session.commit()
    admin_headers = {"Authorization": f"Bearer {auth_utils.create_access_token({'sub': str(admin.id), 'sv': 0})}"}
    assert client.post(f"/admin/users/{user.id}/disable-2fa", headers=auth_headers).status_code == 403
    before = user.session_version
    assert client.post(f"/admin/users/{user.id}/disable-2fa", headers=admin_headers).status_code == 200
    db_session.expire_all()
    stored = db_session.get(User, user.id)
    assert stored.totp_enabled is False and stored.totp_secret is None
    assert stored.session_version == before  # an admin never signs someone out


def test_deleting_the_account_removes_recovery_codes(client, db_session, user, auth_headers):
    _enrolled(db_session, user)
    two_factor.issue_recovery_codes(db_session, user)
    db_session.commit()
    res = client.post("/account/delete", headers=auth_headers, json={"password": "Password123", "confirmation": "DELETE"})
    assert res.status_code == 200
    db_session.expunge_all()
    assert db_session.query(RecoveryCode).count() == 0
