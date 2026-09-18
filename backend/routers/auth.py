from fastapi import APIRouter, Depends, HTTPException, status, Response, Cookie, Request
import jwt
from sqlalchemy.orm import Session
from sqlalchemy import func
from models.database import get_db, Category
from models.auth import User, UserCreate, UserLogin, UserResponse, ForgotPasswordRequest, ResetPasswordRequest, ChangePasswordRequest
from utils.auth import (
    get_password_hash, verify_password,
    create_verify_token, create_reset_token,
    set_auth_cookies, clear_auth_cookies,
    create_access_token, get_current_user,
    SECRET_KEY, ALGORITHM, cookie_cfg,
)
from services import login_throttle
from utils.email import send_password_reset, send_verification
from utils.limiter import limiter

router = APIRouter(prefix="/auth", tags=["auth"])


# ─── System categories seeded for every new user ──────────────────────────────
SYSTEM_CATEGORIES = [
    {"name": "Salary",             "type": "income",  "color": "#2ecc8a"},
    {"name": "Freelance",          "type": "income",  "color": "#5b8fff"},
    {"name": "Investment Returns", "type": "income",  "color": "#a78bfa"},
    {"name": "Business Income",    "type": "income",  "color": "#f5a623"},
    {"name": "Rental Income",      "type": "income",  "color": "#2ecc8a"},
    {"name": "Other Income",       "type": "income",  "color": "#7880a0"},
    {"name": "Housing & Rent",     "type": "expense", "color": "#ff5f6d"},
    {"name": "Food & Dining",      "type": "expense", "color": "#f5a623"},
    {"name": "Transportation",     "type": "expense", "color": "#7880a0"},
    {"name": "Entertainment",      "type": "expense", "color": "#a78bfa"},
    {"name": "Healthcare",         "type": "expense", "color": "#ff5f6d"},
    {"name": "Shopping",           "type": "expense", "color": "#5b8fff"},
    {"name": "Utilities",          "type": "expense", "color": "#7880a0"},
    {"name": "Travel",             "type": "expense", "color": "#2ecc8a"},
    {"name": "Education",          "type": "expense", "color": "#5b8fff"},
    {"name": "Subscriptions",      "type": "expense", "color": "#a78bfa"},
    {"name": "Groceries",          "type": "expense", "color": "#f5a623"},
    {"name": "Other",              "type": "expense", "color": "#7880a0"},
]


def seed_user_categories(db: Session, user_id: int):
    db.add_all(
        Category(user_id=user_id, name=cat["name"], type=cat["type"], color=cat["color"], is_system=True)
        for cat in SYSTEM_CATEGORIES
    )


# ─── Signup ───────────────────────────────────────────────────────────────────
@router.post("/signup", status_code=status.HTTP_201_CREATED)
@limiter.limit("3/hour")
def signup(request: Request, user: UserCreate, response: Response, db: Session = Depends(get_db)):
    email = str(user.email).strip().lower()
    username = user.username.strip()
    if db.query(User).filter(func.lower(User.email) == email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=400, detail="Username already taken")

    db_user = User(
        email=email,
        username=username,
        hashed_password=get_password_hash(user.password),
        is_verified=False,
    )
    try:
        db.add(db_user)
        db.flush()
        seed_user_categories(db, db_user.id)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(db_user)

    verify_token = create_verify_token(db_user.id, db_user.session_version)
    send_verification(db_user.email, verify_token)

    set_auth_cookies(response, db_user.id, db_user.session_version)
    return {
        "id": db_user.id,
        "email": db_user.email,
        "username": db_user.username,
        "is_verified": db_user.is_verified,
        "is_admin": db_user.is_admin,
        "created_at": db_user.created_at,
    }


# ─── Login (rate limited per address, locked per account) ────────────────────
@router.post("/login")
@limiter.limit("5/minute")
def login(request: Request, user: UserLogin, response: Response, db: Session = Depends(get_db)):
    identifier = user.identifier.strip()

    # Second line of defence behind the per-address limit: an identifier that
    # has failed too often is refused outright, even with the right password,
    # until its lock expires. See `services.login_throttle`.
    wait = login_throttle.seconds_locked(db, identifier)
    if wait is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed attempts. Try again in {wait} seconds.",
            headers={"Retry-After": str(wait)},
        )

    if "@" in identifier:
        db_user = db.query(User).filter(func.lower(User.email) == identifier.lower()).first()
    else:
        db_user = db.query(User).filter(User.username == identifier).first()

    if not db_user or not verify_password(user.password, db_user.hashed_password):
        login_throttle.record_failure(db, identifier)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    login_throttle.clear(db, identifier)
    set_auth_cookies(response, db_user.id, db_user.session_version)
    return {"message": "Logged in successfully"}


# ─── Logout ───────────────────────────────────────────────────────────────────
@router.post("/logout")
def logout(
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_user.session_version += 1
    db.commit()
    clear_auth_cookies(response)
    return {"message": "Logged out successfully"}


# ─── Refresh access token ─────────────────────────────────────────────────────
@router.post("/refresh")
@limiter.limit("30/minute")
def refresh(request: Request, response: Response, db: Session = Depends(get_db), refresh_token: str = Cookie(None)):
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = jwt.decode(refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "refresh":
            raise ValueError("wrong token type")
        user_id = int(payload["sub"])
    except (jwt.InvalidTokenError, ValueError, KeyError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if payload.get("sv", 0) != user.session_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session has been revoked")

    # Rotate both cookies. A refresh token that is replaced on every use has a
    # lifetime of one round-trip in the wild rather than thirty days; an old
    # copy still decodes but the `sv` check and the fresh expiry bound what it
    # can do, and logout / password change revoke every copy at once.
    set_auth_cookies(response, user.id, user.session_version)
    return {"message": "Token refreshed"}


# ─── Get current user ─────────────────────────────────────────────────────────
@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


# ─── Change password (authenticated) ─────────────────────────────────────────
@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    current_user.hashed_password = get_password_hash(body.new_password)
    current_user.session_version += 1
    db.commit()
    set_auth_cookies(response, current_user.id, current_user.session_version)
    return {"message": "Password changed successfully"}


# ─── Forgot password ──────────────────────────────────────────────────────────
@router.post("/forgot-password")
@limiter.limit("3/minute")
def forgot_password(request: Request, body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    # Signup stores emails lower-cased; match the same way so a capitalised
    # address does not silently receive nothing.
    user = db.query(User).filter(func.lower(User.email) == str(body.email).strip().lower()).first()
    if user:
        token = create_reset_token(user.id, user.session_version)
        send_password_reset(user.email, token)
    # Always return same response to prevent email enumeration
    return {"message": "If that email is registered, a reset link has been sent"}


# ─── Reset password ───────────────────────────────────────────────────────────
@router.post("/reset-password")
@limiter.limit("5/minute")
def reset_password(request: Request, body: ResetPasswordRequest, db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(body.token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "reset":
            raise ValueError("wrong token type")
        user_id = int(payload["sub"])
    except (jwt.InvalidTokenError, ValueError, KeyError):
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.get("sv", 0) != user.session_version:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user.hashed_password = get_password_hash(body.new_password)
    user.session_version += 1
    db.commit()
    return {"message": "Password reset successfully. You can now log in."}


# ─── Verify email ─────────────────────────────────────────────────────────────
@router.get("/verify-email")
def verify_email(token: str, db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "verify":
            raise ValueError("wrong token type")
        user_id = int(payload["sub"])
    except (jwt.InvalidTokenError, ValueError, KeyError):
        raise HTTPException(status_code=400, detail="Invalid or expired verification token")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.get("sv", 0) != user.session_version:
        raise HTTPException(status_code=400, detail="Invalid or expired verification token")

    user.is_verified = True
    db.commit()
    return {"message": "Email verified successfully"}
