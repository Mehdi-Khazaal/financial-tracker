import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, create_engine
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def utc_now() -> datetime:
    """Return naive UTC for existing TIMESTAMP WITHOUT TIME ZONE columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    type = Column(String(50), nullable=False)
    balance = Column(Numeric(15, 2), nullable=False, default=0)
    credit_limit = Column(Numeric(15, 2), nullable=True)
    currency = Column(String(3), default="USD")
    plaid_account_id = Column(String(200), nullable=True, unique=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    transactions = relationship("Transaction", back_populates="account", cascade="all, delete-orphan")
    outgoing_transfers = relationship(
        "Transfer",
        foreign_keys="Transfer.from_account_id",
        back_populates="from_account",
        cascade="all, delete-orphan",
    )
    incoming_transfers = relationship(
        "Transfer",
        foreign_keys="Transfer.to_account_id",
        back_populates="to_account",
        cascade="all, delete-orphan",
    )
    savings_goals = relationship("SavingsGoal", back_populates="account")


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(100), nullable=False)
    type = Column(String(20), nullable=False)
    color = Column(String(7), default="#5b8fff")
    is_system = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    transactions = relationship("Transaction", back_populates="category")


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"))
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    amount = Column(Numeric(15, 2), nullable=False)
    description = Column(Text)
    plaid_tx_id = Column(String(200), nullable=True, unique=True)
    transaction_date = Column(Date, nullable=False)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    account = relationship("Account", back_populates="transactions")
    category = relationship("Category", back_populates="transactions")


class Transfer(Base):
    __tablename__ = "transfers"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    from_account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    to_account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    note = Column(Text, nullable=True)
    transfer_date = Column(Date, nullable=False)
    created_at = Column(DateTime, default=utc_now)

    from_account = relationship("Account", foreign_keys=[from_account_id], back_populates="outgoing_transfers")
    to_account = relationship("Account", foreign_keys=[to_account_id], back_populates="incoming_transfers")


class Asset(Base):
    __tablename__ = "assets"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    type = Column(String(50), nullable=False)
    asset_class = Column(String(20), nullable=False, default="physical")
    quantity = Column(Numeric(15, 4), nullable=True)
    value_per_unit = Column(Numeric(15, 2), nullable=True)
    total_value = Column(Numeric(15, 2), nullable=False)
    currency = Column(String(3), default="USD")
    purchase_date = Column(Date, nullable=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class RecurringTransaction(Base):
    __tablename__ = "recurring_transactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"))
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    amount = Column(Numeric(15, 2), nullable=False)
    description = Column(Text, nullable=True)
    period = Column(String(20), nullable=False)
    next_date = Column(Date, nullable=False)
    is_active = Column(Boolean, default=True)
    is_variable = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utc_now)


class Loan(Base):
    __tablename__ = "loans"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    borrower_name = Column(String(100), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    amount_repaid = Column(Numeric(15, 2), nullable=False, default=0)
    note = Column(Text, nullable=True)
    loan_date = Column(Date, nullable=False)
    due_date = Column(Date, nullable=True)
    status = Column(String(20), nullable=False, default="active")
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class SavingsGoal(Base):
    __tablename__ = "savings_goals"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(100), nullable=False)
    target_amount = Column(Numeric(15, 2), nullable=False)
    deadline = Column(Date, nullable=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    account = relationship("Account", back_populates="savings_goals")
    allocations = relationship("SavingsGoalAllocation", back_populates="goal", cascade="all, delete-orphan")


class SavingsGoalAllocation(Base):
    __tablename__ = "savings_goal_allocations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    goal_id = Column(Integer, ForeignKey("savings_goals.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)

    goal = relationship("SavingsGoal", back_populates="allocations")
    account = relationship("Account")


# ─── AI Assistant ─────────────────────────────────────────────────────────────
class AssistantConversation(Base):
    __tablename__ = "assistant_conversations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), nullable=False, default="New chat")
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    messages = relationship(
        "AssistantMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="AssistantMessage.id",
    )


class AssistantMessage(Base):
    __tablename__ = "assistant_messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("assistant_conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(20), nullable=False)  # "user" | "assistant"
    content = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, default=utc_now)

    conversation = relationship("AssistantConversation", back_populates="messages")


class AssistantMemory(Base):
    """Durable facts the assistant has learned about the user — its persistent notebook."""

    __tablename__ = "assistant_memories"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utc_now)


class AccountBalanceSnapshot(Base):
    """Materialized month-end closing balances per account.

    The `/history/net-worth` endpoint used to re-sum every transaction on every
    request in Python — O(months × N) per call, unusable once a user has years
    of history. This table stores one row per (account, month-end) so the
    endpoint becomes an indexed ORDER BY LIMIT scan. Refreshed nightly by the
    cron worker and on-demand via the admin endpoint after bulk imports.

    Deliberately month-granular: daily rows are 30× the volume for no user-
    visible benefit — every chart in the app is monthly. Add a separate table
    if daily granularity is ever needed.
    """

    __tablename__ = "account_balance_snapshots"
    __table_args__ = (
        UniqueConstraint("account_id", "snapshot_date", name="uq_snapshot_account_date"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    snapshot_date = Column(Date, nullable=False, index=True)
    closing_balance = Column(Numeric(15, 2), nullable=False)
    computed_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class MerchantCanonical(Base):
    """One row per canonical merchant name.

    Plaid returns wildly inconsistent merchant strings — "AMZN Mktp US*A12BC",
    "Amazon.com*ABC", "AMAZON MKTP" — which explodes the transaction list and
    makes category auto-fill useless. This table stores the human-facing
    canonical name plus the category this merchant is *usually* filed under.
    """

    __tablename__ = "merchants_canonical"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False, unique=True, index=True)
    default_category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class MerchantAlias(Base):
    """Maps a raw Plaid/user-typed merchant string → canonical merchant."""

    __tablename__ = "merchant_aliases"

    id = Column(Integer, primary_key=True, index=True)
    raw_name = Column(String(200), nullable=False, unique=True, index=True)
    canonical_id = Column(Integer, ForeignKey("merchants_canonical.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=utc_now)

    canonical = relationship("MerchantCanonical")


class IdempotencyKey(Base):
    """Stores request/response fingerprints so retried writes are safe.

    The client picks a UUID for each mutation and sends it as
    `Idempotency-Key`. The middleware records the response the first time and
    replays it on any repeat within `expires_at`. If the client resends the
    same key with a *different* body we return 409 — that signals the client
    generated a fresh operation but forgot to rotate the key.
    """

    __tablename__ = "idempotency_keys"
    __table_args__ = (
        UniqueConstraint("user_id", "key", name="uq_idempotency_user_key"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    key = Column(String(80), nullable=False, index=True)
    method = Column(String(10), nullable=False)
    path = Column(String(300), nullable=False)
    request_hash = Column(String(64), nullable=False)
    response_status = Column(Integer, nullable=False)
    response_body = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, default=utc_now)
    expires_at = Column(DateTime, nullable=False, index=True)


class Job(Base):
    """Postgres-backed background job.

    Chosen over Redis / RQ / Celery because the app already depends on
    Postgres and a single-writer worker is enough for the volume — nightly
    Plaid refresh, snapshot rollup, weekly digest emails. Rows go through
    pending → running → done|failed|dead; retries use exponential backoff
    and cap at `MAX_TRIES` after which the job is marked dead for manual
    review instead of looping forever.
    """

    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    kind = Column(String(80), nullable=False, index=True)
    payload = Column(Text, nullable=False, default="{}")
    run_at = Column(DateTime, nullable=False, default=utc_now, index=True)
    status = Column(String(20), nullable=False, default="pending", index=True)
    tries = Column(Integer, nullable=False, default=0)
    last_error = Column(Text, nullable=True)
    locked_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)
