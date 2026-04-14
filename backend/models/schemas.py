from pydantic import BaseModel, Field, validator
from datetime import date, datetime
from typing import Optional
from decimal import Decimal

# ============ ACCOUNT SCHEMAS ============

class AccountBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    type: str = Field(..., min_length=1, max_length=50)
    balance: Decimal = Field(default=0, ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)

class AccountCreate(AccountBase):
    pass

class AccountUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    type: Optional[str] = Field(None, min_length=1, max_length=50)
    balance: Optional[Decimal] = Field(None, ge=0)
    currency: Optional[str] = Field(None, min_length=3, max_length=3)

class AccountResponse(AccountBase):
    id: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


# ============ CATEGORY SCHEMAS ============

class CategoryBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    type: str = Field(..., pattern="^(income|expense)$")
    color: str = Field(default="#6366f1", pattern="^#[0-9A-Fa-f]{6}$")

class CategoryCreate(CategoryBase):
    pass

class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    type: Optional[str] = Field(None, pattern="^(income|expense)$")
    color: Optional[str] = Field(None, pattern="^#[0-9A-Fa-f]{6}$")

class CategoryResponse(CategoryBase):
    id: int
    created_at: datetime
    
    class Config:
        from_attributes = True


# ============ TRANSACTION SCHEMAS ============

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
    id: int
    created_at: datetime
    
    class Config:
        from_attributes = True


# ============ ASSET SCHEMAS ============

class AssetBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    type: str = Field(..., min_length=1, max_length=50)
    quantity: Optional[Decimal] = Field(None, ge=0)
    value_per_unit: Optional[Decimal] = Field(None, ge=0)
    total_value: Decimal = Field(..., ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    purchase_date: Optional[date] = None

class AssetCreate(AssetBase):
    pass

class AssetUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    type: Optional[str] = Field(None, min_length=1, max_length=50)
    quantity: Optional[Decimal] = Field(None, ge=0)
    value_per_unit: Optional[Decimal] = Field(None, ge=0)
    total_value: Optional[Decimal] = Field(None, ge=0)
    currency: Optional[str] = Field(None, min_length=3, max_length=3)
    purchase_date: Optional[date] = None

class AssetResponse(AssetBase):
    id: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True