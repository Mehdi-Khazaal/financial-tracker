from pydantic import BaseModel, ConfigDict
from typing import Optional, Literal, List
from decimal import Decimal
from datetime import datetime, date


# The one definition of a recurring cadence. Create and update must share it —
# when update accepted a bare `str`, a PATCH could set a period no scheduler
# understood, `_next_date` returned the date unchanged, and `process-due`
# re-materialized the same transaction (and re-adjusted the balance) on every
# run. Anything that widens this set must widen `services.recurring_schedule`
# in the same change.
RecurringPeriod = Literal["weekly", "biweekly", "monthly", "quarterly", "yearly"]


# ─── Account ─────────────────────────────────────────────────────────────────
class AccountBase(BaseModel):
    name: str
    type: Literal["checking", "savings", "credit_card", "cash", "investment"]
    balance: Decimal = Decimal("0")
    credit_limit: Optional[Decimal] = None
    currency: str = "USD"

class AccountCreate(AccountBase):
    pass

class AccountUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    credit_limit: Optional[Decimal] = None
    currency: Optional[str] = None

class AccountResponse(AccountBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime


# ─── Category ─────────────────────────────────────────────────────────────────
class CategoryBase(BaseModel):
    name: str
    type: Literal["income", "expense"]
    color: str = "#5b8fff"

class CategoryCreate(CategoryBase):
    pass

class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    color: Optional[str] = None

class CategoryResponse(CategoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: Optional[int]
    is_system: bool
    created_at: datetime


# ─── Transaction ──────────────────────────────────────────────────────────────
class TransactionBase(BaseModel):
    account_id: int
    category_id: Optional[int] = None
    amount: Decimal
    description: Optional[str] = None
    transaction_date: date

class TransactionCreate(TransactionBase):
    pass

class TransactionUpdate(BaseModel):
    account_id: Optional[int] = None
    category_id: Optional[int] = None
    amount: Optional[Decimal] = None
    description: Optional[str] = None
    transaction_date: Optional[date] = None

class TransactionResponse(TransactionBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    created_at: datetime

    # Merchant identity, so the client groups on the same answer the backend
    # computed instead of re-deriving it from the description. Only these
    # three are exposed: the rest of the Plaid metadata is not needed for
    # rendering and would bloat a list response that can carry 1000 rows.
    # Null on rows written before Phase 5A, until the backfill has run — the
    # client falls back to local normalization for those.
    merchant_key: Optional[str] = None
    plaid_merchant_entity_id: Optional[str] = None
    category_source: Optional[str] = None


# ─── Transfer ─────────────────────────────────────────────────────────────────
class TransferBase(BaseModel):
    from_account_id: int
    to_account_id: int
    amount: Decimal
    note: Optional[str] = None
    transfer_date: date

class TransferCreate(TransferBase):
    pass

class TransferResponse(TransferBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    created_at: datetime


# ─── Asset ────────────────────────────────────────────────────────────────────
class AssetBase(BaseModel):
    name: str
    type: str
    asset_class: Literal["investment", "physical"] = "physical"
    quantity: Optional[Decimal] = None
    value_per_unit: Optional[Decimal] = None
    total_value: Decimal
    currency: str = "USD"
    purchase_date: Optional[date] = None

class AssetCreate(AssetBase):
    pass

class AssetUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    asset_class: Optional[str] = None
    quantity: Optional[Decimal] = None
    value_per_unit: Optional[Decimal] = None
    total_value: Optional[Decimal] = None
    currency: Optional[str] = None
    purchase_date: Optional[date] = None

class AssetResponse(AssetBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime


# ─── Savings Goal ─────────────────────────────────────────────────────────────
class SavingsGoalBase(BaseModel):
    name: str
    target_amount: Decimal
    account_id: Optional[int] = None
    deadline: Optional[date] = None

class SavingsGoalCreate(SavingsGoalBase):
    pass

class SavingsGoalUpdate(BaseModel):
    name: Optional[str] = None
    target_amount: Optional[Decimal] = None
    account_id: Optional[int] = None
    deadline: Optional[date] = None

# ─── Recurring Transaction ────────────────────────────────────────────────────
class RecurringTransactionBase(BaseModel):
    account_id: int
    category_id: Optional[int] = None
    amount: Decimal
    description: Optional[str] = None
    period: RecurringPeriod
    next_date: date
    is_variable: bool = False

class RecurringTransactionCreate(RecurringTransactionBase):
    pass

class RecurringTransactionUpdate(BaseModel):
    account_id: Optional[int] = None
    category_id: Optional[int] = None
    amount: Optional[Decimal] = None
    description: Optional[str] = None
    period: Optional[RecurringPeriod] = None
    next_date: Optional[date] = None
    is_active: Optional[bool] = None
    is_variable: Optional[bool] = None

class RecurringTransactionResponse(RecurringTransactionBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    is_active: bool
    is_variable: bool
    created_at: datetime

class LogVariableRecurringRequest(BaseModel):
    amount: Decimal
    transaction_date: Optional[date] = None


class AllocationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int
    account_name: str
    amount: Decimal

class AllocationItem(BaseModel):
    account_id: int
    amount: Decimal

class SetAllocationsRequest(BaseModel):
    allocations: list[AllocationItem]

class SavingsGoalResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    name: str
    target_amount: Decimal
    deadline: Optional[date] = None
    created_at: datetime
    allocations: list[AllocationResponse] = []
    current_amount: Decimal = Decimal("0")


# ─── Loan ─────────────────────────────────────────────────────────────────────
class SpendFromGoalRequest(BaseModel):
    account_id: int
    amount: Decimal
    description: Optional[str] = None
    transaction_date: date


class LoanCreate(BaseModel):
    borrower_name: str
    amount: Decimal
    note: Optional[str] = None
    loan_date: date
    due_date: Optional[date] = None

class LoanUpdate(BaseModel):
    borrower_name: Optional[str] = None
    amount: Optional[Decimal] = None
    amount_repaid: Optional[Decimal] = None
    note: Optional[str] = None
    due_date: Optional[date] = None
    status: Optional[str] = None

class LoanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    borrower_name: str
    amount: Decimal
    amount_repaid: Decimal
    note: Optional[str] = None
    loan_date: date
    due_date: Optional[date] = None
    status: str
    created_at: datetime
    updated_at: datetime
