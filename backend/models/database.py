import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, create_engine
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
