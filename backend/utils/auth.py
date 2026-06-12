import os
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, Request, status
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from models.auth import User
from models.database import get_db
from utils.logging import get_logger, kv

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY environment variable is required. "
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
    )

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7
REFRESH_TOKEN_EXPIRE_DAYS = 30

IS_PROD = os.getenv("ENVIRONMENT") == "production"
logger = get_logger(__name__)


def cookie_cfg(path: str = "/") -> dict:
    samesite = "none" if IS_PROD else "lax"
    return {"httponly": True, "secure": IS_PROD, "samesite": samesite, "path": path}


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


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


def set_auth_cookies(response, user_id: int) -> str:
    access = create_access_token({"sub": str(user_id)})
    refresh = create_refresh_token({"sub": str(user_id)})
    response.set_cookie("access_token", access, max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60, **cookie_cfg())
    response.set_cookie("refresh_token", refresh, max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600, **cookie_cfg())
    return access


def clear_auth_cookies(response):
    response.delete_cookie("access_token", **cookie_cfg())
    response.delete_cookie("refresh_token", **cookie_cfg())


def _get_request_token(request: Request) -> Optional[str]:
    cookie_token = request.cookies.get("access_token")
    if cookie_token:
        return cookie_token

    auth_header = request.headers.get("Authorization", "")
    if not auth_header:
        return None
    if not auth_header.startswith("Bearer "):
        logger.warning("unsupported_authorization_header %s", kv(path=request.url.path))
        return None

    token = auth_header[7:].strip()
    return token or None


async def get_current_user(request: Request, db: Session = Depends(get_db)):
    token = _get_request_token(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "access":
            raise ValueError("wrong token type")
        user_id = int(payload["sub"])
    except (JWTError, ValueError, KeyError):
        logger.info("invalid_access_token %s", kv(path=request.url.path))
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        logger.info("user_not_found_for_token %s", kv(path=request.url.path, user_id=user_id))
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user
