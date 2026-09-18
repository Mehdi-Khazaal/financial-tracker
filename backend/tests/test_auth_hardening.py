"""Brute-force lockout, refresh rotation, and the reset-mail email match."""

from datetime import timedelta

import jwt

from models.auth import AuthFailure
from models.database import utc_now
from routers import auth as auth_router
from services import login_throttle
from utils.auth import ALGORITHM, SECRET_KEY, create_refresh_token
from utils.limiter import limiter


def _login(client, identifier, password):
    # The per-address limit is a separate control; reset it so this file
    # exercises the per-account lockout on its own.
    limiter.reset()
    return client.post("/auth/login", json={"identifier": identifier, "password": password})


# ─── Lockout ──────────────────────────────────────────────────────────────────
def test_repeated_failures_lock_the_account_even_for_the_right_password(client, db_session, user):
    for _ in range(login_throttle.LOCKOUT_THRESHOLD):
        assert _login(client, user.email, "wrong-password").status_code == 401

    locked = _login(client, user.email, "Password123")
    assert locked.status_code == 429
    assert "Retry-After" in locked.headers
    assert int(locked.headers["Retry-After"]) >= 1

    row = db_session.query(AuthFailure).filter_by(identifier=user.email.lower()).one()
    assert row.failures == login_throttle.LOCKOUT_THRESHOLD
    assert row.locked_until is not None


def test_lockout_is_per_identifier_and_case_insensitive(client, db_session, user):
    for _ in range(login_throttle.LOCKOUT_THRESHOLD):
        _login(client, user.email.upper(), "wrong-password")

    assert _login(client, user.email, "Password123").status_code == 429
    # A different account is untouched.
    assert _login(client, "someone-else", "whatever").status_code == 401


def test_lock_expires_and_a_success_clears_the_counter(client, db_session, user):
    for _ in range(login_throttle.LOCKOUT_THRESHOLD):
        _login(client, user.email, "wrong-password")
    row = db_session.query(AuthFailure).filter_by(identifier=user.email.lower()).one()
    row.locked_until = utc_now() - timedelta(seconds=1)
    db_session.commit()

    assert _login(client, user.email, "Password123").status_code == 200
    assert db_session.query(AuthFailure).count() == 0


def test_lock_grows_with_every_further_failure(client, db_session, user):
    for _ in range(login_throttle.LOCKOUT_THRESHOLD + 2):
        db_session.expire_all()
        row = db_session.query(AuthFailure).filter_by(identifier=user.email.lower()).first()
        if row is not None and row.locked_until is not None:
            # Step past the current lock so the next failure is counted.
            row.locked_until = utc_now() - timedelta(seconds=1)
            db_session.commit()
        _login(client, user.email, "wrong-password")

    db_session.expire_all()
    row = db_session.query(AuthFailure).filter_by(identifier=user.email.lower()).one()
    lock = (row.locked_until - utc_now()).total_seconds()
    assert lock > login_throttle.BASE_LOCK_SECONDS * 3  # 60 → 120 → 240 seconds
    assert lock <= login_throttle.MAX_LOCK_SECONDS


def test_old_failures_are_forgotten(client, db_session, user):
    for _ in range(login_throttle.LOCKOUT_THRESHOLD - 1):
        _login(client, user.email, "wrong-password")
    row = db_session.query(AuthFailure).filter_by(identifier=user.email.lower()).one()
    row.last_failure_at = utc_now() - login_throttle.FAILURE_WINDOW - timedelta(minutes=1)
    db_session.commit()

    _login(client, user.email, "wrong-password")
    db_session.expire_all()
    assert db_session.query(AuthFailure).filter_by(identifier=user.email.lower()).one().failures == 1


# ─── Refresh rotation ─────────────────────────────────────────────────────────
def test_refresh_rotates_both_cookies(client, user):
    original = create_refresh_token({"sub": str(user.id), "sv": user.session_version})
    client.cookies.set("refresh_token", original)

    response = client.post("/auth/refresh")

    assert response.status_code == 200
    set_cookie = response.headers.get_list("set-cookie")
    names = {header.split("=", 1)[0] for header in set_cookie}
    assert names == {"access_token", "refresh_token"}
    new_refresh = next(h for h in set_cookie if h.startswith("refresh_token=")).split(";")[0].split("=", 1)[1]
    assert new_refresh != original
    assert jwt.decode(new_refresh, SECRET_KEY, algorithms=[ALGORITHM])["type"] == "refresh"


def test_revoked_refresh_token_cannot_be_rotated(client, db_session, user):
    stale = create_refresh_token({"sub": str(user.id), "sv": user.session_version})
    user.session_version += 1
    db_session.commit()
    client.cookies.set("refresh_token", stale)

    assert client.post("/auth/refresh").status_code == 401


# ─── Forgot password ──────────────────────────────────────────────────────────
def test_forgot_password_matches_email_case_insensitively(client, user, monkeypatch):
    sent = []
    monkeypatch.setattr(auth_router, "send_password_reset", lambda email, token: sent.append(email))

    response = client.post("/auth/forgot-password", json={"email": user.email.upper()})

    assert response.status_code == 200
    assert sent == [user.email]


def test_forgot_password_is_silent_for_unknown_emails(client, monkeypatch):
    sent = []
    monkeypatch.setattr(auth_router, "send_password_reset", lambda email, token: sent.append(email))

    response = client.post("/auth/forgot-password", json={"email": "nobody@example.com"})

    assert response.status_code == 200
    assert sent == []
