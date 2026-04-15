from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import or_
from models.database import get_db, Category
from models.auth import User, UserCreate, UserLogin, UserResponse, Token
from utils.auth import get_password_hash, verify_password, create_access_token, get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


# ─── System categories seeded for every new user ──────────────────────────────
SYSTEM_CATEGORIES = [
    # Income
    {"name": "Salary",             "type": "income",  "color": "#2ecc8a"},
    {"name": "Freelance",          "type": "income",  "color": "#5b8fff"},
    {"name": "Investment Returns", "type": "income",  "color": "#a78bfa"},
    {"name": "Business Income",    "type": "income",  "color": "#f5a623"},
    {"name": "Rental Income",      "type": "income",  "color": "#2ecc8a"},
    {"name": "Other Income",       "type": "income",  "color": "#7880a0"},
    # Expense
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
        db.add(Category(
            user_id=user_id,
            name=cat["name"],
            type=cat["type"],
            color=cat["color"],
            is_system=True,
        ))
    db.commit()


@router.post("/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def signup(user: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == user.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    if db.query(User).filter(User.username == user.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")

    db_user = User(
        email=user.email,
        username=user.username,
        hashed_password=get_password_hash(user.password),
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    seed_user_categories(db, db_user.id)
    return db_user


@router.post("/login", response_model=Token)
def login(user: UserLogin, db: Session = Depends(get_db)):
    # Accept email or username
    db_user = db.query(User).filter(
        or_(User.email == user.identifier, User.username == user.identifier)
    ).first()

    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(data={"sub": str(db_user.id)})
    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user
