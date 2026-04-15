from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from models.database import get_db, Loan
from models.auth import User
from models.schemas import LoanCreate, LoanUpdate, LoanResponse
from utils.auth import get_current_user

router = APIRouter(prefix="/loans", tags=["loans"])


@router.get("/", response_model=List[LoanResponse])
def list_loans(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return (
        db.query(Loan)
        .filter(Loan.user_id == current_user.id)
        .order_by(Loan.status, Loan.loan_date.desc())
        .all()
    )


@router.post("/", response_model=LoanResponse, status_code=status.HTTP_201_CREATED)
def create_loan(data: LoanCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    loan = Loan(**data.model_dump(), user_id=current_user.id)
    db.add(loan)
    db.commit()
    db.refresh(loan)
    return loan


@router.patch("/{loan_id}", response_model=LoanResponse)
def update_loan(loan_id: int, data: LoanUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.user_id == current_user.id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(loan, k, v)
    # Auto-mark as repaid if fully paid
    if float(loan.amount_repaid) >= float(loan.amount) and loan.status == "active":
        loan.status = "repaid"
    db.commit()
    db.refresh(loan)
    return loan


@router.delete("/{loan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_loan(loan_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    loan = db.query(Loan).filter(Loan.id == loan_id, Loan.user_id == current_user.id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    db.delete(loan)
    db.commit()
