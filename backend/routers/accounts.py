from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session
from typing import List
from models.database import (
    Account,
    RecurringTransaction,
    SavingsGoal,
    SavingsGoalAllocation,
    Transaction,
    Transfer,
    get_db,
)
from models.auth import User
from models.schemas import AccountCreate, AccountUpdate, AccountResponse
from utils.auth import get_current_user

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.post("/", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
def create_account(account: AccountCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_account = Account(**account.model_dump(), user_id=current_user.id)
    db.add(db_account)
    db.commit()
    db.refresh(db_account)
    return db_account


@router.get("/", response_model=List[AccountResponse])
def get_accounts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Account).filter(Account.user_id == current_user.id).order_by(Account.created_at).all()


@router.get("/{account_id}", response_model=AccountResponse)
def get_account(account_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    account = db.query(Account).filter(Account.id == account_id, Account.user_id == current_user.id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


@router.put("/{account_id}", response_model=AccountResponse)
def update_account(account_id: int, update: AccountUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    account = db.query(Account).filter(Account.id == account_id, Account.user_id == current_user.id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(account, field, value)
    db.commit()
    db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    account = db.query(Account).filter(Account.id == account_id, Account.user_id == current_user.id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    has_financial_history = any(
        (
            db.query(Transaction.id).filter(Transaction.account_id == account.id).first(),
            db.query(Transfer.id)
            .filter(or_(Transfer.from_account_id == account.id, Transfer.to_account_id == account.id))
            .first(),
            db.query(RecurringTransaction.id).filter(RecurringTransaction.account_id == account.id).first(),
            db.query(SavingsGoal.id).filter(SavingsGoal.account_id == account.id).first(),
            db.query(SavingsGoalAllocation.id).filter(SavingsGoalAllocation.account_id == account.id).first(),
        )
    )
    if has_financial_history:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Account with financial history cannot be deleted",
        )
    db.delete(account)
    db.commit()
