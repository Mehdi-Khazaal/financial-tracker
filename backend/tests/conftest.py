import os
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

TEST_DB_PATH = Path(tempfile.gettempdir()) / f"financial_tracker_backend_tests_{os.getpid()}.db"
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"
os.environ.setdefault("ENVIRONMENT", "test")

if TEST_DB_PATH.exists():
    TEST_DB_PATH.unlink()

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models.auth import User
from models.database import Account, Base, Category, SessionLocal, get_db
from routers import accounts, assistant, auth, cron, recurring_transactions, stocks, transactions
from utils import auth as auth_utils
from utils.limiter import limiter


engine = create_engine(
    os.environ["DATABASE_URL"],
    connect_args={"check_same_thread": False},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app = FastAPI()
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(transactions.router)
app.include_router(recurring_transactions.router)
app.include_router(cron.router)
app.include_router(stocks.router)
app.include_router(assistant.router)
app.dependency_overrides[get_db] = override_get_db
app.dependency_overrides[auth_utils.get_db] = override_get_db


@pytest.fixture(autouse=True)
def reset_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def db_session():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def user(db_session):
    db_user = User(
        email="user@example.com",
        username="user1",
        hashed_password=auth_utils.get_password_hash("Password123"),
        is_verified=True,
        is_admin=False,
    )
    db_session.add(db_user)
    db_session.commit()
    db_session.refresh(db_user)
    return db_user


@pytest.fixture
def auth_headers(user):
    token = auth_utils.create_access_token({"sub": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def account(db_session, user):
    db_account = Account(
        user_id=user.id,
        name="Primary Checking",
        type="checking",
        balance=1000,
        currency="USD",
    )
    db_session.add(db_account)
    db_session.commit()
    db_session.refresh(db_account)
    return db_account


@pytest.fixture
def second_account(db_session, user):
    db_account = Account(
        user_id=user.id,
        name="Savings",
        type="savings",
        balance=250,
        currency="USD",
    )
    db_session.add(db_account)
    db_session.commit()
    db_session.refresh(db_account)
    return db_account


@pytest.fixture
def category(db_session, user):
    db_category = Category(
        user_id=user.id,
        name="Food",
        type="expense",
        color="#ff5f6d",
    )
    db_session.add(db_category)
    db_session.commit()
    db_session.refresh(db_category)
    return db_category
