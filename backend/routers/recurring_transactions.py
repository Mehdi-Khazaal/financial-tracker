from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from datetime import date, timedelta
import calendar

from models.database import get_db, RecurringTransaction, Transaction, Account
from models.auth import User
from models.schemas import RecurringTransactionCreate, RecurringTransactionUpdate, RecurringTransactionResponse, TransactionResponse, LogVariableRecurringRequest
from utils.auth import get_current_user

router = APIRouter(prefix="/recurring", tags=["recurring"])


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
    for k, v in data.model_dump(exclude_unset=True).items():
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
def process_due(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
        account = db.query(Account).filter(Account.id == rec.account_id).first()
        if not account:
            continue
        tx = Transaction(
            user_id=current_user.id,
            account_id=rec.account_id,
            category_id=rec.category_id,
            amount=rec.amount,
            description=rec.description,
            transaction_date=rec.next_date,
        )
        db.add(tx)
        account.balance = float(account.balance) + float(rec.amount)
        rec.next_date = _next_date(rec.next_date, rec.period)
        created.append(tx)
    db.commit()
    for tx in created:
        db.refresh(tx)
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

    account = db.query(Account).filter(Account.id == rec.account_id).first()
    if not account:
        raise HTTPException(status_code=400, detail="Account not found")

    tx_date = data.transaction_date or rec.next_date
    tx = Transaction(
        user_id=current_user.id,
        account_id=rec.account_id,
        category_id=rec.category_id,
        amount=data.amount,
        description=rec.description,
        transaction_date=tx_date,
    )
    db.add(tx)
    account.balance = float(account.balance) + float(data.amount)
    # Save this amount as the new estimate for next time
    rec.amount = data.amount
    rec.next_date = _next_date(rec.next_date, rec.period)
    db.commit()
    db.refresh(tx)
    return tx
