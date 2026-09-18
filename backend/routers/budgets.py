"""Budgets: one monthly allowance per expense category, and how it is going."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from models.auth import User
from models.database import Budget, Category, Transaction, TransactionSplit, get_db
from services import budgets as budget_service
from utils.auth import get_current_user
from utils.dates import user_today
from utils.etag import check_etag, compute_user_etag, set_etag_headers

router = APIRouter(prefix="/budgets", tags=["budgets"])


# ─── Schemas ──────────────────────────────────────────────────────────────────
class BudgetCreate(BaseModel):
    category_id: int
    amount: Decimal = Field(gt=0, le=Decimal("9999999999999.99"))
    rollover: bool = False
    # First month the budget applies to, as YYYY-MM. Defaults to this month.
    starts_month: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}$")

    @field_validator("amount")
    @classmethod
    def two_places(cls, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"))


class BudgetUpdate(BaseModel):
    amount: Optional[Decimal] = Field(default=None, gt=0, le=Decimal("9999999999999.99"))
    rollover: Optional[bool] = None
    is_active: Optional[bool] = None

    @field_validator("amount")
    @classmethod
    def two_places(cls, value: Optional[Decimal]) -> Optional[Decimal]:
        return value.quantize(Decimal("0.01")) if value is not None else None


class BudgetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category_id: int
    amount: Decimal
    rollover: bool
    starts_on: date
    is_active: bool


class BudgetProgressOut(BaseModel):
    id: int
    category_id: int
    category_name: str
    category_color: str
    month: str
    amount: Decimal
    carried: Decimal
    available: Decimal
    spent: Decimal
    remaining: Decimal
    percent: Decimal
    over: bool
    rollover: bool


class BudgetProgressSummary(BaseModel):
    month: str
    budgeted: Decimal
    spent: Decimal
    remaining: Decimal
    over_count: int
    budgets: List[BudgetProgressOut]


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _owned_budget(db: Session, budget_id: int, user_id: int) -> Budget:
    row = db.query(Budget).filter(Budget.id == budget_id, Budget.user_id == user_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Budget not found")
    return row


def _owned_expense_category(db: Session, category_id: int, user_id: int) -> Category:
    category = db.query(Category).filter(Category.id == category_id, Category.user_id == user_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    if category.type != "expense":
        raise HTTPException(status_code=400, detail="Budgets apply to expense categories only.")
    return category


def _serialize_progress(item: budget_service.BudgetProgress) -> BudgetProgressOut:
    return BudgetProgressOut(
        id=item.budget.id,
        category_id=item.budget.category_id,
        category_name=item.category_name,
        category_color=item.category_color,
        month=item.month,
        amount=item.amount,
        carried=item.carried,
        available=item.available,
        spent=item.spent,
        remaining=item.remaining,
        percent=item.percent,
        over=item.over,
        rollover=bool(item.budget.rollover),
    )


# ─── Routes ───────────────────────────────────────────────────────────────────
@router.get("/", response_model=List[BudgetOut])
def list_budgets(request: Request, response: Response, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    etag = compute_user_etag(db, current_user.id, [Budget])
    if check_etag(request, etag):
        return Response(status_code=304, headers={"ETag": f'W/"{etag}"', "Cache-Control": "private, no-cache"})
    set_etag_headers(response, etag)
    return db.query(Budget).filter(Budget.user_id == current_user.id).order_by(Budget.id).all()


@router.post("/", response_model=BudgetOut, status_code=status.HTTP_201_CREATED)
def create_budget(body: BudgetCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _owned_expense_category(db, body.category_id, current_user.id)
    if db.query(Budget.id).filter(Budget.user_id == current_user.id, Budget.category_id == body.category_id).first():
        raise HTTPException(status_code=409, detail="This category already has a budget. Edit it instead.")
    try:
        starts_on = budget_service.parse_month(body.starts_month, user_today(current_user))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    row = Budget(
        user_id=current_user.id,
        category_id=body.category_id,
        amount=body.amount,
        rollover=body.rollover,
        starts_on=starts_on,
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/{budget_id}", response_model=BudgetOut)
def update_budget(budget_id: int, body: BudgetUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = _owned_budget(db, budget_id, current_user.id)
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_budget(budget_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = _owned_budget(db, budget_id, current_user.id)
    db.delete(row)
    db.commit()


@router.get("/progress", response_model=BudgetProgressSummary)
def budget_progress(
    request: Request,
    response: Response,
    month: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Every active budget's spent / available for one month (default: now).

    Cached with an ETag over budgets *and* transactions, so a pull-to-refresh
    that changed nothing is a 304.
    """
    etag = compute_user_etag(db, current_user.id, [Budget, Transaction, TransactionSplit]) + (f"-{month}" if month else "-current")
    if check_etag(request, etag):
        return Response(status_code=304, headers={"ETag": f'W/"{etag}"', "Cache-Control": "private, no-cache"})
    set_etag_headers(response, etag)

    try:
        first = budget_service.parse_month(month, user_today(current_user))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    items = [_serialize_progress(p) for p in budget_service.progress_for_month(db, current_user, first)]
    return BudgetProgressSummary(
        month=budget_service.month_key(first),
        budgeted=sum((i.available for i in items), Decimal("0")),
        spent=sum((i.spent for i in items), Decimal("0")),
        remaining=sum((i.remaining for i in items), Decimal("0")),
        over_count=sum(1 for i in items if i.over),
        budgets=items,
    )
