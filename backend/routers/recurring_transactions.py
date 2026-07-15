from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy import or_
from sqlalchemy.orm import Session
from typing import List
from datetime import date, timedelta
from decimal import Decimal
import calendar

from models.database import get_db, RecurringTransaction, Transaction, Account, Category
from models.auth import User
from models.schemas import RecurringTransactionCreate, RecurringTransactionUpdate, RecurringTransactionResponse, TransactionResponse, LogVariableRecurringRequest
from utils.auth import get_current_user
from utils.push_sender import send_push_to_user

router = APIRouter(prefix="/recurring", tags=["recurring"])


def _owned_account(db: Session, account_id: int, user_id: int) -> Account:
    account = db.query(Account).filter(Account.id == account_id, Account.user_id == user_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


def _find_owned_category(db: Session, category_id: int, user_id: int) -> Category | None:
    return (
        db.query(Category)
        .filter(Category.id == category_id)
        .filter(or_(Category.user_id == user_id, Category.user_id.is_(None)))
        .first()
    )


def _owned_category(db: Session, category_id: int | None, user_id: int) -> Category | None:
    if category_id is None:
        return None
    category = _find_owned_category(db, category_id, user_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    return category


def _next_date(current: date, period: str) -> date:
    if period == "weekly":
        return current + timedelta(weeks=1)
    if period == "biweekly":
        return current + timedelta(weeks=2)
    if period == "monthly":
        month = current.month + 1
        year  = current.year
        if month > 12: month, year = 1, year + 1
        day = min(current.day, calendar.monthrange(year, month)[1])
        return date(year, month, day)
    if period == "quarterly":
        month = current.month + 3
        year  = current.year
        while month > 12: month -= 12; year += 1
        day = min(current.day, calendar.monthrange(year, month)[1])
        return date(year, month, day)
    if period == "yearly":
        try:
            return date(current.year + 1, current.month, current.day)
        except ValueError:
            return date(current.year + 1, current.month, 28)
    return current


@router.get("/", response_model=List[RecurringTransactionResponse])
def list_recurring(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return (
        db.query(RecurringTransaction)
        .filter(RecurringTransaction.user_id == current_user.id)
        .order_by(RecurringTransaction.next_date)
        .all()
    )


@router.post("/", response_model=RecurringTransactionResponse, status_code=status.HTTP_201_CREATED)
def create_recurring(data: RecurringTransactionCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _owned_account(db, data.account_id, current_user.id)
    _owned_category(db, data.category_id, current_user.id)
    rec = RecurringTransaction(**data.model_dump(), user_id=current_user.id)
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


@router.patch("/{rec_id}", response_model=RecurringTransactionResponse)
def update_recurring(rec_id: int, data: RecurringTransactionUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rec = db.query(RecurringTransaction).filter(RecurringTransaction.id == rec_id, RecurringTransaction.user_id == current_user.id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Not found")
    changes = data.model_dump(exclude_unset=True)
    if "account_id" in changes:
        _owned_account(db, changes["account_id"], current_user.id)
    if "category_id" in changes:
        _owned_category(db, changes["category_id"], current_user.id)
    for k, v in changes.items():
        setattr(rec, k, v)
    db.commit()
    db.refresh(rec)
    return rec


@router.delete("/{rec_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recurring(rec_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rec = db.query(RecurringTransaction).filter(RecurringTransaction.id == rec_id, RecurringTransaction.user_id == current_user.id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(rec)
    db.commit()


@router.post("/process-due", response_model=List[TransactionResponse])
def process_due(background: BackgroundTasks, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Create transactions for all overdue FIXED recurring entries. Variable ones are skipped."""
    today = date.today()
    due = (
        db.query(RecurringTransaction)
        .filter(
            RecurringTransaction.user_id == current_user.id,
            RecurringTransaction.is_active == True,
            RecurringTransaction.is_variable == False,
            RecurringTransaction.next_date <= today,
        )
        .all()
    )
    created = []
    for rec in due:
        account = db.query(Account).filter(Account.id == rec.account_id, Account.user_id == rec.user_id).first()
        if not account:
            continue
        category = _find_owned_category(db, rec.category_id, rec.user_id) if rec.category_id is not None else None
        if rec.category_id is not None and not category:
            continue
        tx = Transaction(
            user_id=current_user.id,
            account_id=rec.account_id,
            category_id=category.id if category else None,
            amount=rec.amount,
            description=rec.description,
            transaction_date=rec.next_date,
        )
        db.add(tx)
        account.balance = Decimal(str(account.balance)) + Decimal(str(rec.amount))
        rec.next_date = _next_date(rec.next_date, rec.period)
        created.append(tx)
    db.commit()
    for tx in created:
        db.refresh(tx)

    if created:
        n = len(created)
        msg = f"{created[0].description}" if n == 1 else f"{n} recurring transactions"
        background.add_task(send_push_to_user, db, current_user.id,
                            "Recurring transactions processed",
                            f"{msg} {'was' if n == 1 else 'were'} recorded automatically.",
                            url="/recurring", tag="recurring")
    return created


@router.post("/{rec_id}/log", response_model=TransactionResponse)
def log_variable(
    rec_id: int,
    data: LogVariableRecurringRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Log a variable-amount recurring bill with the actual amount for this period."""
    rec = db.query(RecurringTransaction).filter(
        RecurringTransaction.id == rec_id,
        RecurringTransaction.user_id == current_user.id,
    ).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Not found")

    account = _owned_account(db, rec.account_id, current_user.id)
    category = _owned_category(db, rec.category_id, current_user.id)

    tx_date = data.transaction_date or rec.next_date
    tx = Transaction(
        user_id=current_user.id,
        account_id=rec.account_id,
        category_id=category.id if category else None,
        amount=data.amount,
        description=rec.description,
        transaction_date=tx_date,
    )
    db.add(tx)
    account.balance = Decimal(str(account.balance)) + Decimal(str(data.amount))
    # Save this amount as the new estimate for next time
    rec.amount = data.amount
    rec.next_date = _next_date(rec.next_date, rec.period)
    db.commit()
    db.refresh(tx)
    return tx
