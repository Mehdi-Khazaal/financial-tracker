from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import date
from decimal import Decimal
from models.database import get_db, Transaction, Account
from models.auth import User
from models.schemas import TransactionCreate, TransactionUpdate, TransactionResponse
from utils.auth import get_current_user

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _get_account(db: Session, account_id: int, user_id: int) -> Account:
    account = db.query(Account).filter(Account.id == account_id, Account.user_id == user_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


@router.post("/", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
def create_transaction(tx: TransactionCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    account = _get_account(db, tx.account_id, current_user.id)
    db_tx = Transaction(**tx.model_dump(), user_id=current_user.id)
    db.add(db_tx)
    account.balance = Account.balance + Decimal(str(tx.amount))
    db.commit()
    db.refresh(db_tx)
    return db_tx


@router.get("/", response_model=List[TransactionResponse])
def get_transactions(
    account_id: Optional[int] = Query(None),
    category_id: Optional[int] = Query(None),
    type: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    search: Optional[str] = Query(None),
    amount_min: Optional[float] = Query(None),
    amount_max: Optional[float] = Query(None),
    limit: int = Query(500, le=1000),
    skip: int = Query(0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Transaction).filter(Transaction.user_id == current_user.id)
    if account_id:
        q = q.filter(Transaction.account_id == account_id)
    if category_id:
        q = q.filter(Transaction.category_id == category_id)
    if type == "income":
        q = q.filter(Transaction.amount > 0)
    elif type == "expense":
        q = q.filter(Transaction.amount < 0)
    if date_from:
        q = q.filter(Transaction.transaction_date >= date_from)
    if date_to:
        q = q.filter(Transaction.transaction_date <= date_to)
    if search:
        q = q.filter(Transaction.description.ilike(f"%{search}%"))
    if amount_min is not None:
        q = q.filter(func.abs(Transaction.amount) >= amount_min)
    if amount_max is not None:
        q = q.filter(func.abs(Transaction.amount) <= amount_max)
    return q.order_by(Transaction.transaction_date.desc(), Transaction.created_at.desc()).offset(skip).limit(limit).all()


@router.get("/{transaction_id}", response_model=TransactionResponse)
def get_transaction(transaction_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tx = db.query(Transaction).filter(Transaction.id == transaction_id, Transaction.user_id == current_user.id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return tx


@router.put("/{transaction_id}", response_model=TransactionResponse)
def update_transaction(transaction_id: int, update: TransactionUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tx = db.query(Transaction).filter(Transaction.id == transaction_id, Transaction.user_id == current_user.id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    old_amount = float(tx.amount)
    old_account_id = tx.account_id
    data = update.model_dump(exclude_unset=True)
    new_account_id = data.get("account_id", old_account_id)
    new_amount = float(data.get("amount", old_amount))

    if old_account_id != new_account_id:
        old_account = _get_account(db, old_account_id, current_user.id)
        old_account.balance = Account.balance - Decimal(str(old_amount))
        new_account = _get_account(db, new_account_id, current_user.id)
        new_account.balance = Account.balance + Decimal(str(new_amount))
    else:
        account = _get_account(db, old_account_id, current_user.id)
        account.balance = Account.balance - Decimal(str(old_amount)) + Decimal(str(new_amount))

    for field, value in data.items():
        setattr(tx, field, value)
    db.commit()
    db.refresh(tx)
    return tx


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(transaction_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tx = db.query(Transaction).filter(Transaction.id == transaction_id, Transaction.user_id == current_user.id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    account = _get_account(db, tx.account_id, current_user.id)
    account.balance = Account.balance - Decimal(str(tx.amount))
    db.delete(tx)
    db.commit()
