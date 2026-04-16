import os
from fastapi import APIRouter, Depends, HTTPException, status, Response, Cookie, Request
from sqlalchemy.orm import Session
from sqlalchemy import or_
from jose import JWTError, jwt
from models.database import get_db, Category
from models.auth import User, UserCreate, UserLogin, UserResponse, ForgotPasswordRequest, ResetPasswordRequest, ChangePasswordRequest
from utils.auth import (
    get_password_hash, verify_password,
    create_verify_token, create_reset_token,
    set_auth_cookies, clear_auth_cookies,
    create_access_token, get_current_user,
    SECRET_KEY, ALGORITHM, cookie_cfg,
)
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
    for cat in SYSTEM_CATEGORIES:
        db.add(Category(user_id=user_id, name=cat["name"], type=cat["type"], color=cat["color"], is_system=True))
    db.commit()


# ─── Signup ───────────────────────────────────────────────────────────────────
@router.post("/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def signup(user: UserCreate, response: Response, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == user.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    if db.query(User).filter(User.username == user.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")

    db_user = User(
        email=user.email,
        username=user.username,
        hashed_password=get_password_hash(user.password),
        is_verified=False,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    seed_user_categories(db, db_user.id)

    verify_token = create_verify_token(db_user.id)
    send_verification(db_user.email, verify_token)

    set_auth_cookies(response, db_user.id)
    return db_user


# ─── Login (rate limited) ─────────────────────────────────────────────────────
@router.post("/login")
@limiter.limit("5/minute")
def login(request: Request, user: UserLogin, response: Response, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(
        or_(User.email == user.identifier, User.username == user.identifier)
    ).first()

    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    # Auto-promote to admin if email matches ADMIN_EMAIL env var
    admin_email = os.getenv("ADMIN_EMAIL", "").lower()
    if admin_email and db_user.email.lower() == admin_email and not db_user.is_admin:
        db_user.is_admin = True
        db.commit()

    set_auth_cookies(response, db_user.id)
    return {"message": "Logged in successfully"}


# ─── Logout ───────────────────────────────────────────────────────────────────
@router.post("/logout")
def logout(response: Response):
    clear_auth_cookies(response)
    return {"message": "Logged out successfully"}


# ─── Refresh access token ─────────────────────────────────────────────────────
@router.post("/refresh")
def refresh(response: Response, db: Session = Depends(get_db), refresh_token: str = Cookie(None)):
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = jwt.decode(refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "refresh":
            raise ValueError("wrong token type")
        user_id = int(payload["sub"])
    except (JWTError, ValueError, KeyError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    from utils.auth import ACCESS_TOKEN_EXPIRE_MINUTES
    new_access = create_access_token({"sub": str(user_id)})
    response.set_cookie("access_token", new_access, max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60, **cookie_cfg())
    return {"message": "Token refreshed"}


# ─── Get current user ─────────────────────────────────────────────────────────
@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


# ─── Change password (authenticated) ─────────────────────────────────────────
@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    current_user.hashed_password = get_password_hash(body.new_password)
    db.commit()
    return {"message": "Password changed successfully"}


# ─── Forgot password ──────────────────────────────────────────────────────────
@router.post("/forgot-password")
@limiter.limit("3/minute")
def forgot_password(request: Request, body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email).first()
    if user:
        token = create_reset_token(user.id)
        send_password_reset(user.email, token)
    # Always return same response to prevent email enumeration
    return {"message": "If that email is registered, a reset link has been sent"}


# ─── Reset password ───────────────────────────────────────────────────────────
@router.post("/reset-password")
def reset_password(body: ResetPasswordRequest, db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(body.token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "reset":
            raise ValueError("wrong token type")
        user_id = int(payload["sub"])
    except (JWTError, ValueError, KeyError):
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.hashed_password = get_password_hash(body.new_password)
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
    except (JWTError, ValueError, KeyError):
        raise HTTPException(status_code=400, detail="Invalid or expired verification token")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_verified = True
    db.commit()
    return {"message": "Email verified successfully"}
