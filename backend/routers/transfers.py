from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from decimal import Decimal
from models.database import get_db, Transfer, Account
from models.auth import User
from models.schemas import TransferCreate, TransferResponse
from utils.auth import get_current_user

router = APIRouter(prefix="/transfers", tags=["transfers"])


def _get_account(db: Session, account_id: int, user_id: int) -> Account:
    account = db.query(Account).filter(Account.id == account_id, Account.user_id == user_id).first()
    if not account:
        raise HTTPException(status_code=404, detail=f"Account {account_id} not found")
    return account


@router.post("/", response_model=TransferResponse, status_code=status.HTTP_201_CREATED)
def create_transfer(transfer: TransferCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if transfer.from_account_id == transfer.to_account_id:
        raise HTTPException(status_code=400, detail="Cannot transfer to the same account")
    if float(transfer.amount) <= 0:
        raise HTTPException(status_code=400, detail="Transfer amount must be positive")

    from_account = _get_account(db, transfer.from_account_id, current_user.id)
    to_account   = _get_account(db, transfer.to_account_id,   current_user.id)

    db_transfer = Transfer(**transfer.model_dump(), user_id=current_user.id)
    db.add(db_transfer)

    from_account.balance = Account.balance - Decimal(str(transfer.amount))
    to_account.balance   = Account.balance + Decimal(str(transfer.amount))

    db.commit()
    db.refresh(db_transfer)
    return db_transfer


@router.get("/", response_model=List[TransferResponse])
def get_transfers(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return (
        db.query(Transfer)
        .filter(Transfer.user_id == current_user.id)
        .order_by(Transfer.transfer_date.desc(), Transfer.created_at.desc())
        .all()
    )


@router.get("/{transfer_id}", response_model=TransferResponse)
def get_transfer(transfer_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    transfer = db.query(Transfer).filter(Transfer.id == transfer_id, Transfer.user_id == current_user.id).first()
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")
    return transfer


@router.delete("/{transfer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transfer(transfer_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    transfer = db.query(Transfer).filter(Transfer.id == transfer_id, Transfer.user_id == current_user.id).first()
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")

    # Reverse the balance changes
    from_account = _get_account(db, transfer.from_account_id, current_user.id)
    to_account   = _get_account(db, transfer.to_account_id,   current_user.id)
    from_account.balance = Account.balance + Decimal(str(transfer.amount))
    to_account.balance   = Account.balance - Decimal(str(transfer.amount))

    db.delete(transfer)
    db.commit()
