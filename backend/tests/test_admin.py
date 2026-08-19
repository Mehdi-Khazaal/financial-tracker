"""Admin endpoints: authorization, and what a password reset actually does.

The admin surface is two endpoints and had no coverage at all, which meant
nothing proved the most important property: that `require_admin` is enforced on
the server and not merely by hiding a button. Every authorization test below
calls the endpoint directly with a normal user's credentials, because that is
the attack a frontend guard cannot prevent.

The product behaviour under test is deliberate and must not drift: an admin
reset **sends an email**. It never sets a password, never chooses one, never
sees one, and never signs the target out. Revocation belongs to the moment the
*user* completes the reset — an admin able to invalidate sessions on request
could sign someone out of every device without their involvement.
"""

import jwt
import pytest

from models.auth import User
from utils import auth as auth_utils
from utils.limiter import limiter


@pytest.fixture(autouse=True)
def fresh_rate_limit():
    """Give each test its own rate-limit budget.

    The reset endpoint is limited per remote address, and every test here
    shares one ("testclient"), so without this the suite would exhaust the
    budget partway through and later tests would fail on 429 for reasons that
    have nothing to do with what they assert. Resetting is the honest fix; the
    limit itself is verified deliberately in
    `test_the_reset_endpoint_is_rate_limited`.
    """
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def admin(db_session):
    db_admin = User(
        email="admin@example.com",
        username="admin1",
        hashed_password=auth_utils.get_password_hash("Password123"),
        is_verified=True,
        is_admin=True,
    )
    db_session.add(db_admin)
    db_session.commit()
    db_session.refresh(db_admin)
    return db_admin


@pytest.fixture
def admin_headers(admin):
    token = auth_utils.create_access_token({"sub": str(admin.id), "sv": admin.session_version})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def captured_reset(monkeypatch):
    """Capture what would have been emailed, so we can assert it stayed there."""
    sent = {}

    def fake_send(email, token):
        sent["email"] = email
        sent["token"] = token
        return True

    monkeypatch.setattr("routers.admin.send_password_reset", fake_send)
    return sent


# --- Authorization -----------------------------------------------------------
def test_listing_users_requires_authentication(client):
    assert client.get("/admin/users").status_code == 401


def test_reset_requires_authentication(client, user):
    assert client.post(f"/admin/users/{user.id}/reset-password").status_code == 401


def test_a_normal_user_cannot_list_users(client, auth_headers):
    assert client.get("/admin/users", headers=auth_headers).status_code == 403


def test_a_normal_user_cannot_reset_another_users_password(
    client, auth_headers, admin, captured_reset
):
    """The attack a frontend guard cannot stop: calling the endpoint directly."""
    response = client.post(f"/admin/users/{admin.id}/reset-password", headers=auth_headers)
    assert response.status_code == 403
    # Rejected before any side effect: no mail, no token minted.
    assert captured_reset == {}


def test_a_normal_user_cannot_reset_their_own_password_this_way(
    client, auth_headers, user, captured_reset
):
    """Self-service reset is `/auth/forgot-password`; this route is admin-only."""
    response = client.post(f"/admin/users/{user.id}/reset-password", headers=auth_headers)
    assert response.status_code == 403
    assert captured_reset == {}


def test_an_admin_can_list_users(client, admin_headers, user):
    response = client.get("/admin/users", headers=admin_headers)
    assert response.status_code == 200
    assert {u["username"] for u in response.json()} >= {"user1", "admin1"}


def test_an_admin_can_request_a_reset_for_another_user(
    client, admin_headers, user, captured_reset
):
    response = client.post(f"/admin/users/{user.id}/reset-password", headers=admin_headers)
    assert response.status_code == 200
    assert captured_reset["email"] == user.email


def test_an_admin_can_request_a_reset_for_themselves(
    client, admin_headers, admin, captured_reset
):
    response = client.post(f"/admin/users/{admin.id}/reset-password", headers=admin_headers)
    assert response.status_code == 200
    assert captured_reset["email"] == admin.email


def test_an_unknown_user_is_a_404(client, admin_headers, captured_reset):
    response = client.post("/admin/users/999999/reset-password", headers=admin_headers)
    assert response.status_code == 404
    assert captured_reset == {}


# --- Nothing sensitive leaves the server -------------------------------------
def test_the_reset_token_is_never_returned_to_the_admin(
    client, admin_headers, user, captured_reset
):
    response = client.post(f"/admin/users/{user.id}/reset-password", headers=admin_headers)
    assert captured_reset["token"] not in response.text
    assert "token" not in response.json()


def test_no_password_material_is_returned(client, admin_headers, user, captured_reset):
    body = client.post(
        f"/admin/users/{user.id}/reset-password", headers=admin_headers
    ).text.lower()
    for forbidden in ("password_hash", "hashed_password", "$2b$", "new_password"):
        assert forbidden not in body


def test_the_user_listing_never_exposes_password_hashes(client, admin_headers, user):
    response = client.get("/admin/users", headers=admin_headers)
    assert "hashed_password" not in response.text
    assert "$2b$" not in response.text
    for row in response.json():
        assert set(row) == {"id", "email", "username", "is_verified", "is_admin", "created_at"}


# --- Session semantics -------------------------------------------------------
def test_requesting_a_reset_does_not_sign_the_target_out(
    client, admin_headers, auth_headers, user, db_session, captured_reset
):
    """An admin must not be able to revoke someone's sessions unilaterally."""
    before = user.session_version

    response = client.post(f"/admin/users/{user.id}/reset-password", headers=admin_headers)
    assert response.status_code == 200

    db_session.expire_all()
    assert db_session.query(User).filter_by(id=user.id).one().session_version == before
    # The target's existing credentials still work.
    assert client.get("/auth/me", headers=auth_headers).status_code == 200


def test_completing_the_reset_does_revoke_prior_sessions(
    client, admin_headers, auth_headers, user, db_session, captured_reset
):
    client.post(f"/admin/users/{user.id}/reset-password", headers=admin_headers)

    completed = client.post(
        "/auth/reset-password",
        json={"token": captured_reset["token"], "new_password": "BrandNewPass1"},
    )
    assert completed.status_code == 200, completed.text

    db_session.expire_all()
    assert db_session.query(User).filter_by(id=user.id).one().session_version > 0
    # Tokens minted before the reset are now dead.
    assert client.get("/auth/me", headers=auth_headers).status_code == 401


def test_the_emailed_token_cannot_be_replayed(client, admin_headers, user, captured_reset):
    client.post(f"/admin/users/{user.id}/reset-password", headers=admin_headers)
    token = captured_reset["token"]

    first = client.post(
        "/auth/reset-password", json={"token": token, "new_password": "BrandNewPass1"}
    )
    assert first.status_code == 200
    second = client.post(
        "/auth/reset-password", json={"token": token, "new_password": "AnotherPass12"}
    )
    assert second.status_code == 400


def test_the_token_carries_no_password_material(client, admin_headers, user, captured_reset):
    client.post(f"/admin/users/{user.id}/reset-password", headers=admin_headers)
    payload = jwt.decode(
        captured_reset["token"], auth_utils.SECRET_KEY, algorithms=[auth_utils.ALGORITHM]
    )
    assert set(payload) == {"sub", "sv", "exp", "type"}
    assert payload["type"] == "reset"


# --- Audit trail -------------------------------------------------------------
def test_the_request_is_logged_with_identifiers_only(
    client, admin_headers, admin, user, captured_reset, caplog
):
    with caplog.at_level("INFO", logger="routers.admin"):
        client.post(f"/admin/users/{user.id}/reset-password", headers=admin_headers)

    entries = [
        record.getMessage()
        for record in caplog.records
        if "admin_password_reset_requested" in record.getMessage()
    ]
    assert len(entries) == 1
    entry = entries[0]
    assert f"actor_user_id={admin.id}" in entry
    assert f"target_user_id={user.id}" in entry
    # Identifiers only: never the token, the address, or anything derived from
    # the password.
    assert captured_reset["token"] not in entry
    assert user.email not in entry


def test_the_reset_endpoint_is_rate_limited(client, admin_headers, user, captured_reset):
    """Matches `/auth/forgot-password`: neither should be an unbounded sender.

    Without a limit an admin account could be used to mail-bomb any address in
    the user table, so the cap is part of the behaviour, not an incidental
    detail of the framework.
    """
    codes = [
        client.post(f"/admin/users/{user.id}/reset-password", headers=admin_headers).status_code
        for _ in range(4)
    ]
    assert codes[:3] == [200, 200, 200]
    assert codes[3] == 429
