from models.database import Category
from models.auth import User
import jwt

from routers.auth import SYSTEM_CATEGORIES
from utils.auth import ALGORITHM, SECRET_KEY, get_password_hash, verify_password


def test_signup_sets_auth_cookies_and_seeds_categories(client, db_session):
    response = client.post(
        "/auth/signup",
        json={
            "email": "newuser@example.com",
            "username": "newuser",
            "password": "Password123",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "newuser@example.com"
    assert body["is_verified"] is False
    assert "access_token=" in response.headers["set-cookie"]
    assert "refresh_token=" in response.headers["set-cookie"]

    categories = db_session.query(Category).filter(Category.user_id == body["id"]).all()
    assert len(categories) == len(SYSTEM_CATEGORIES)
    assert all(category.is_system for category in categories)


def test_login_accepts_username_without_runtime_admin_promotion(client, db_session, monkeypatch, user):
    monkeypatch.setenv("ADMIN_EMAIL", user.email)

    response = client.post(
        "/auth/login",
        json={"identifier": user.username, "password": "Password123"},
    )

    assert response.status_code == 200
    assert response.json()["message"] == "Logged in successfully"
    db_session.expire_all()
    updated_user = db_session.get(type(user), user.id)
    assert updated_user.is_admin is False
    assert "access_token" not in response.json()


def test_login_normalizes_email_case_and_whitespace(client, user):
    response = client.post(
        "/auth/login",
        json={"identifier": f"  {user.email.upper()}  ", "password": "Password123"},
    )

    assert response.status_code == 200
    assert response.json() == {"message": "Logged in successfully"}


def test_email_login_does_not_match_another_users_username(client, db_session, user):
    conflicting_username = User(
        email="different@example.com",
        username=user.email.upper(),
        hashed_password=get_password_hash("DifferentPassword123"),
        is_verified=True,
        is_admin=False,
    )
    db_session.add(conflicting_username)
    db_session.commit()

    response = client.post(
        "/auth/login",
        json={"identifier": user.email, "password": "Password123"},
    )

    assert response.status_code == 200
    me = client.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["id"] == user.id


def test_signup_rejects_case_variant_of_existing_email(client, user):
    response = client.post(
        "/auth/signup",
        json={
            "email": user.email.upper(),
            "username": "another-user",
            "password": "Password123",
        },
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Email already registered"}


def test_refresh_rejects_wrong_token_type(client):
    bad_token = jwt.encode({"sub": "42", "type": "access"}, SECRET_KEY, algorithm=ALGORITHM)

    response = client.post("/auth/refresh", cookies={"refresh_token": bad_token})

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired refresh token"


def test_reset_password_updates_hash_and_allows_new_login(client, db_session, user):
    reset_response = client.post(
        "/auth/reset-password",
        json={
            "token": jwt.encode({"sub": str(user.id), "type": "reset"}, SECRET_KEY, algorithm=ALGORITHM),
            "new_password": "NewPassword123",
        },
    )

    assert reset_response.status_code == 200
    db_session.refresh(user)
    assert verify_password("NewPassword123", user.hashed_password)

    login_response = client.post(
        "/auth/login",
        json={"identifier": user.email, "password": "NewPassword123"},
    )
    assert login_response.status_code == 200


def test_password_reset_revokes_existing_access_token(client, db_session, user):
    from utils.auth import create_access_token

    old_access = create_access_token({"sub": str(user.id), "sv": user.session_version})
    reset_token = jwt.encode(
        {"sub": str(user.id), "type": "reset", "sv": user.session_version},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )

    response = client.post(
        "/auth/reset-password",
        json={"token": reset_token, "new_password": "NewPassword123"},
    )

    assert response.status_code == 200
    me_response = client.get("/auth/me", headers={"Authorization": f"Bearer {old_access}"})
    assert me_response.status_code == 401
    assert me_response.json()["detail"] == "Session has been revoked"


def test_reset_token_is_one_time_use(client, user):
    reset_token = jwt.encode(
        {"sub": str(user.id), "type": "reset", "sv": user.session_version},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )
    body = {"token": reset_token, "new_password": "NewPassword123"}

    assert client.post("/auth/reset-password", json=body).status_code == 200
    assert client.post("/auth/reset-password", json=body).status_code == 400
