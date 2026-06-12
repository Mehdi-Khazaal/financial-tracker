from models.database import Category
from jose import jwt

from routers.auth import SYSTEM_CATEGORIES
from utils.auth import ALGORITHM, SECRET_KEY, verify_password


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


def test_login_accepts_username_and_promotes_configured_admin(client, db_session, monkeypatch, user):
    monkeypatch.setenv("ADMIN_EMAIL", user.email)

    response = client.post(
        "/auth/login",
        json={"identifier": user.username, "password": "Password123"},
    )

    assert response.status_code == 200
    assert response.json()["message"] == "Logged in successfully"
    db_session.expire_all()
    updated_user = db_session.get(type(user), user.id)
    assert updated_user.is_admin is True


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
