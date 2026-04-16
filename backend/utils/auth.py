import os
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
import bcrypt
from fastapi import Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from models.database import get_db
from models.auth import User

# ── Secrets ───────────────────────────────────────────────────────────────────
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY environment variable is required. "
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
    )

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 15
REFRESH_TOKEN_EXPIRE_DAYS = 7

# ── Cookie settings ───────────────────────────────────────────────────────────
# On Render set ENVIRONMENT=production; localhost uses lax/non-secure cookies
IS_PROD = os.getenv("ENVIRONMENT") == "production"


def cookie_cfg(path: str = "/") -> dict:
    return {"httponly": True, "secure": IS_PROD, "samesite": "lax", "path": path}


# ── Password hashing ──────────────────────────────────────────────────────────
def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


# ── Token creation ────────────────────────────────────────────────────────────
def _make_token(data: dict, expires_delta: timedelta, token_type: str) -> str:
    payload = data.copy()
    payload.update({"exp": datetime.utcnow() + expires_delta, "type": token_type})
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def create_access_token(data: dict) -> str:
    return _make_token(data, timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES), "access")


def create_refresh_token(data: dict) -> str:
    return _make_token(data, timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS), "refresh")


def create_reset_token(user_id: int) -> str:
    return _make_token({"sub": str(user_id)}, timedelta(hours=1), "reset")


def create_verify_token(user_id: int) -> str:
    return _make_token({"sub": str(user_id)}, timedelta(hours=24), "verify")


# ── Cookie helpers ────────────────────────────────────────────────────────────
def set_auth_cookies(response, user_id: int):
    access = create_access_token({"sub": str(user_id)})
    refresh = create_refresh_token({"sub": str(user_id)})
    response.set_cookie("access_token", access, max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60, **cookie_cfg())
    response.set_cookie("refresh_token", refresh, max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600, **cookie_cfg())


def clear_auth_cookies(response):
    response.delete_cookie("access_token", **cookie_cfg())
    response.delete_cookie("refresh_token", **cookie_cfg())


# ── Dependency ────────────────────────────────────────────────────────────────
async def get_current_user(request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "access":
            raise ValueError("wrong token type")
        user_id = int(payload["sub"])
    except (JWTError, ValueError, KeyError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user
