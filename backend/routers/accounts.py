from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from models.database import get_db, Account
from models.schemas import AccountCreate, AccountUpdate, AccountResponse
from models.auth import User
from utils.auth import get_current_user

router = APIRouter(prefix="/accounts", tags=["accounts"])

# ============ CREATE ACCOUNT ============
@router.post("/", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
def create_account(account: AccountCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_account = Account(**account.dict(), user_id=current_user.id)
    db.add(db_account)
    db.commit()
    db.refresh(db_account)
    return db_account

# ============ GET ALL ACCOUNTS ============
@router.get("/", response_model=List[AccountResponse])
def get_accounts(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    accounts = db.query(Account).filter(Account.user_id == current_user.id).offset(skip).limit(limit).all()
    return accounts

# ============ GET SINGLE ACCOUNT ============
@router.get("/{account_id}", response_model=AccountResponse)
def get_account(account_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    account = db.query(Account).filter(Account.id == account_id, Account.user_id == current_user.id).first()
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return account

# ============ UPDATE ACCOUNT ============
@router.put("/{account_id}", response_model=AccountResponse)
def update_account(account_id: int, account_update: AccountUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_account = db.query(Account).filter(Account.id == account_id, Account.user_id == current_user.id).first()
    if db_account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    
    update_data = account_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_account, key, value)
    
    db.commit()
    db.refresh(db_account)
    return db_account

# ============ DELETE ACCOUNT ============
@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_account = db.query(Account).filter(Account.id == account_id, Account.user_id == current_user.id).first()
    if db_account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    
    db.delete(db_account)
    db.commit()
    return None

# ============ GET ACCOUNT BALANCE SUMMARY ============
@router.get("/summary/total-balance")
def get_total_balance(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from sqlalchemy import func
    
    result = db.query(
        Account.currency,
        func.sum(Account.balance).label("total")
    ).filter(Account.user_id == current_user.id).group_by(Account.currency).all()
    
    return {
        "balances": [
            {"currency": currency, "total": float(total)}
            for currency, total in result
        ]
    }