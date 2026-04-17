from sqlalchemy import create_engine, Column, Integer, String, Numeric, DateTime, Date, Text, ForeignKey, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─── Account ─────────────────────────────────────────────────────────────────
class Account(Base):
    __tablename__ = "accounts"

    id           = Column(Integer, primary_key=True, index=True)
    user_id      = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name         = Column(String(100), nullable=False)
    type         = Column(String(50), nullable=False)   # checking|savings|credit_card|cash|investment
    balance      = Column(Numeric(15, 2), nullable=False, default=0)
    credit_limit = Column(Numeric(15, 2), nullable=True)   # credit cards only
    currency     = Column(String(3), default="USD")
    created_at   = Column(DateTime, default=datetime.utcnow)
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    transactions      = relationship("Transaction", back_populates="account", cascade="all, delete-orphan")
    outgoing_transfers = relationship("Transfer", foreign_keys="Transfer.from_account_id", back_populates="from_account", cascade="all, delete-orphan")
    incoming_transfers = relationship("Transfer", foreign_keys="Transfer.to_account_id", back_populates="to_account", cascade="all, delete-orphan")
    savings_goals      = relationship("SavingsGoal", back_populates="account")


# ─── Category ─────────────────────────────────────────────────────────────────
class Category(Base):
    __tablename__ = "categories"

    id        = Column(Integer, primary_key=True, index=True)
    user_id   = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)  # NULL = system
    name      = Column(String(100), nullable=False)
    type      = Column(String(20), nullable=False)   # income|expense
    color     = Column(String(7), default="#5b8fff")
    is_system = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    transactions = relationship("Transaction", back_populates="category")


# ─── Transaction ──────────────────────────────────────────────────────────────
class Transaction(Base):
    __tablename__ = "transactions"

    id               = Column(Integer, primary_key=True, index=True)
    user_id          = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id       = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"))
    category_id      = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    amount           = Column(Numeric(15, 2), nullable=False)
    description      = Column(Text)
    transaction_date = Column(Date, nullable=False)
    created_at       = Column(DateTime, default=datetime.utcnow)

    account  = relationship("Account", back_populates="transactions")
    category = relationship("Category", back_populates="transactions")


# ─── Transfer ─────────────────────────────────────────────────────────────────
# Covers: inter-account transfers, ATM withdrawals, cash deposits, credit card payments
class Transfer(Base):
    __tablename__ = "transfers"

    id              = Column(Integer, primary_key=True, index=True)
    user_id         = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    from_account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    to_account_id   = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    amount          = Column(Numeric(15, 2), nullable=False)
    note            = Column(Text, nullable=True)
    transfer_date   = Column(Date, nullable=False)
    created_at      = Column(DateTime, default=datetime.utcnow)

    from_account = relationship("Account", foreign_keys=[from_account_id], back_populates="outgoing_transfers")
    to_account   = relationship("Account", foreign_keys=[to_account_id],   back_populates="incoming_transfers")


# ─── Asset ────────────────────────────────────────────────────────────────────
# asset_class: "investment" (stock/crypto/gold/etf) | "physical" (real_estate/vehicle/jewelry/art/other)
class Asset(Base):
    __tablename__ = "assets"

    id             = Column(Integer, primary_key=True, index=True)
    user_id        = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name           = Column(String(100), nullable=False)
    type           = Column(String(50), nullable=False)
    asset_class    = Column(String(20), nullable=False, default="physical")  # investment|physical
    quantity       = Column(Numeric(15, 4), nullable=True)
    value_per_unit = Column(Numeric(15, 2), nullable=True)
    total_value    = Column(Numeric(15, 2), nullable=False)
    currency       = Column(String(3), default="USD")
    purchase_date  = Column(Date, nullable=True)
    created_at     = Column(DateTime, default=datetime.utcnow)
    updated_at     = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ─── Recurring Transaction ────────────────────────────────────────────────────
class RecurringTransaction(Base):
    __tablename__ = "recurring_transactions"

    id          = Column(Integer, primary_key=True, index=True)
    user_id     = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id  = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"))
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    amount      = Column(Numeric(15, 2), nullable=False)  # fixed amount, or last known for variable
    description = Column(Text, nullable=True)
    period      = Column(String(20), nullable=False)   # weekly|biweekly|monthly|quarterly|yearly
    next_date   = Column(Date, nullable=False)
    is_active   = Column(Boolean, default=True)
    is_variable = Column(Boolean, default=False)  # True = amount changes each time (bills)
    created_at  = Column(DateTime, default=datetime.utcnow)


# ─── Loan ─────────────────────────────────────────────────────────────────────
class Loan(Base):
    __tablename__ = "loans"

    id             = Column(Integer, primary_key=True, index=True)
    user_id        = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    borrower_name  = Column(String(100), nullable=False)
    amount         = Column(Numeric(15, 2), nullable=False)
    amount_repaid  = Column(Numeric(15, 2), nullable=False, default=0)
    note           = Column(Text, nullable=True)
    loan_date      = Column(Date, nullable=False)
    due_date       = Column(Date, nullable=True)
    status         = Column(String(20), nullable=False, default="active")  # active|repaid|written_off
    created_at     = Column(DateTime, default=datetime.utcnow)
    updated_at     = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ─── Savings Goal ─────────────────────────────────────────────────────────────
class SavingsGoal(Base):
    __tablename__ = "savings_goals"

    id            = Column(Integer, primary_key=True, index=True)
    user_id       = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id    = Column(Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)  # kept for migration compat
    name          = Column(String(100), nullable=False)
    target_amount = Column(Numeric(15, 2), nullable=False)
    deadline      = Column(Date, nullable=True)
    created_at    = Column(DateTime, default=datetime.utcnow)

    account     = relationship("Account", back_populates="savings_goals")
    allocations = relationship("SavingsGoalAllocation", back_populates="goal", cascade="all, delete-orphan")


# ─── Savings Goal Allocation ──────────────────────────────────────────────────
class SavingsGoalAllocation(Base):
    __tablename__ = "savings_goal_allocations"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    goal_id    = Column(Integer, ForeignKey("savings_goals.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    amount     = Column(Numeric(15, 2), nullable=False)

    goal    = relationship("SavingsGoal", back_populates="allocations")
    account = relationship("Account")
