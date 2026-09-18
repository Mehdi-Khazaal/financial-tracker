"""Two-factor settings for the signed-in user, and the login step that completes a 2FA sign-in."""

from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models.auth import User
from models.database import get_db
from services import login_throttle
from services import two_factor
from utils.auth import get_current_user, set_auth_cookies, verify_password
from utils.limiter import limiter
from utils.logging import get_logger, kv

router = APIRouter(prefix="/auth", tags=["auth"])
logger = get_logger(__name__)


class PasswordBody(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class CodeBody(BaseModel):
    code: str = Field(min_length=6, max_length=20)


class DisableBody(BaseModel):
    password: str = Field(min_length=1, max_length=256)
    code: str = Field(min_length=6, max_length=20)


class ChallengeBody(BaseModel):
    challenge: str = Field(min_length=1, max_length=2048)
    code: str = Field(min_length=6, max_length=20)


class StatusOut(BaseModel):
    enabled: bool
    recovery_codes_remaining: int


class SetupOut(BaseModel):
    secret: str
    otpauth_uri: str
    qr_svg: str


class CodesOut(BaseModel):
    recovery_codes: List[str]


def _require_password(user: User, password: str) -> None:
    if not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=403, detail="Password is incorrect.")


@router.get("/2fa", response_model=StatusOut)
def two_factor_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return StatusOut(
        enabled=bool(current_user.totp_enabled),
        recovery_codes_remaining=two_factor.remaining_recovery_codes(db, current_user) if current_user.totp_enabled else 0,
    )


@router.post("/2fa/setup", response_model=SetupOut)
@limiter.limit("5/minute")
def two_factor_setup(request: Request, body: PasswordBody, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Start enrolment: a new pending secret, shown once as a QR code and as text."""
    _require_password(current_user, body.password)
    if current_user.totp_enabled:
        raise HTTPException(status_code=409, detail="Two-factor authentication is already on.")
    result = two_factor.begin_setup(current_user)
    db.commit()
    return SetupOut(**result)


@router.post("/2fa/enable", response_model=CodesOut)
@limiter.limit("10/minute")
def two_factor_enable(request: Request, body: CodeBody, response: Response, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Finish enrolment with a code from the app. Signs out every other session."""
    if current_user.totp_enabled:
        raise HTTPException(status_code=409, detail="Two-factor authentication is already on.")
    codes = two_factor.confirm_setup(db, current_user, body.code)
    if codes is None:
        db.rollback()
        raise HTTPException(status_code=400, detail="That code didn't match. Check the time on your phone and try the newest code.")
    # Anyone already signed in elsewhere got in with the password alone.
    current_user.session_version = (current_user.session_version or 0) + 1
    db.commit()
    set_auth_cookies(response, current_user.id, current_user.session_version)
    logger.info("two_factor_enabled %s", kv(user_id=current_user.id))
    return CodesOut(recovery_codes=codes)


@router.post("/2fa/disable", response_model=StatusOut)
@limiter.limit("5/minute")
def two_factor_disable(request: Request, body: DisableBody, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_password(current_user, body.password)
    if not current_user.totp_enabled:
        return StatusOut(enabled=False, recovery_codes_remaining=0)
    if two_factor.check_code(db, current_user, body.code) is None:
        db.rollback()
        raise HTTPException(status_code=400, detail="That code didn't work.")
    two_factor.disable(db, current_user)
    db.commit()
    logger.info("two_factor_disabled %s", kv(user_id=current_user.id))
    return StatusOut(enabled=False, recovery_codes_remaining=0)


@router.post("/2fa/recovery-codes", response_model=CodesOut)
@limiter.limit("5/minute")
def two_factor_new_codes(request: Request, body: PasswordBody, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Replace every recovery code. The old ones stop working immediately."""
    _require_password(current_user, body.password)
    if not current_user.totp_enabled:
        raise HTTPException(status_code=409, detail="Turn on two-factor authentication first.")
    codes = two_factor.issue_recovery_codes(db, current_user)
    db.commit()
    return CodesOut(recovery_codes=codes)


@router.post("/login/2fa")
@limiter.limit("10/minute")
def login_two_factor(request: Request, body: ChallengeBody, response: Response, db: Session = Depends(get_db)):
    """Second half of a 2FA sign-in: the challenge from `/auth/login` plus a code."""
    payload = two_factor.read_challenge(body.challenge)
    if payload is None:
        raise HTTPException(status_code=401, detail="That sign-in expired. Start again with your password.")
    user = db.query(User).filter(User.id == int(payload["sub"])).first()
    if user is None or user.session_version != payload.get("sv") or not user.totp_enabled:
        raise HTTPException(status_code=401, detail="That sign-in expired. Start again with your password.")

    key = two_factor.throttle_key(user.id)
    wait = login_throttle.seconds_locked(db, key)
    if wait is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many attempts. Try again in {wait} seconds.",
            headers={"Retry-After": str(wait)},
        )
    method = two_factor.check_code(db, user, body.code)
    if method is None:
        db.rollback()
        login_throttle.record_failure(db, key)
        raise HTTPException(status_code=401, detail="That code didn't work.")
    db.commit()
    login_throttle.clear(db, key)
    login_throttle.clear(db, payload.get("ident") or "")
    set_auth_cookies(response, user.id, user.session_version)
    logger.info("login_two_factor %s", kv(user_id=user.id, method=method))
    remaining = two_factor.remaining_recovery_codes(db, user) if method == "recovery" else None
    return {"message": "Logged in successfully", "recovery_codes_remaining": remaining}
