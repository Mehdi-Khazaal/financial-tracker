from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func, or_
from typing import List, Optional
from datetime import date
from decimal import Decimal
from models.database import get_db, Transaction
from models.auth import User
from models.schemas import TransactionCreate, TransactionResponse, TransactionSplitsUpdate, TransactionUpdate
from services import splits as split_service
from services.ledger import LedgerResourceNotFound, LedgerService
from utils.auth import get_current_user

router = APIRouter(prefix="/transactions", tags=["transactions"])


def search_clause(text: str):
    """Free-text match over what a person would type: the description as
    the bank sent it, Plaid's merchant name, and the normalised merchant key —
    so "netflix" finds "NETFLIX.COM 866-579-7172" whichever field carries it.
    Case-insensitive substring; wildcards in the input are literal."""
    needle = "%" + text.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    return or_(
        Transaction.description.ilike(needle, escape="\\"),
        Transaction.plaid_merchant_name.ilike(needle, escape="\\"),
        Transaction.merchant_key.ilike(needle, escape="\\"),
    )


def _not_found(error: LedgerResourceNotFound) -> HTTPException:
    return HTTPException(status_code=404, detail=error.detail)


@router.post("/", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
def create_transaction(tx: TransactionCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        return LedgerService(db).create_transaction(current_user.id, tx.model_dump())
    except LedgerResourceNotFound as error:
        raise _not_found(error) from error


@router.get("/", response_model=List[TransactionResponse])
def get_transactions(
    account_id: Optional[int] = Query(None),
    category_id: Optional[int] = Query(None),
    type: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    search: Optional[str] = Query(None, max_length=100),
    uncategorized: bool = Query(False),
    amount_min: Optional[Decimal] = Query(None),
    amount_max: Optional[Decimal] = Query(None),
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
        q = q.filter(search_clause(search))
    if uncategorized:
        q = q.filter(Transaction.category_id.is_(None))
    if amount_min is not None:
        q = q.filter(func.abs(Transaction.amount) >= amount_min)
    if amount_max is not None:
        q = q.filter(func.abs(Transaction.amount) <= amount_max)
    # Split lines ride along in one extra query for the whole page, so the
    # client can attribute spending per category without a request per row.
    return (
        q.options(selectinload(Transaction.splits))
        .order_by(Transaction.transaction_date.desc(), Transaction.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/{transaction_id}", response_model=TransactionResponse)
def get_transaction(transaction_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tx = db.query(Transaction).filter(Transaction.id == transaction_id, Transaction.user_id == current_user.id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return tx


@router.put("/{transaction_id}", response_model=TransactionResponse)
def update_transaction(transaction_id: int, update: TransactionUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        return LedgerService(db).update_transaction(
            current_user.id,
            transaction_id,
            update.model_dump(exclude_unset=True),
        )
    except LedgerResourceNotFound as error:
        raise _not_found(error) from error


def _own_transaction(db: Session, user_id: int, transaction_id: int) -> Transaction:
    tx = (
        db.query(Transaction)
        .filter(Transaction.id == transaction_id, Transaction.user_id == user_id)
        .with_for_update()
        .first()
    )
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return tx


@router.put("/{transaction_id}/splits", response_model=TransactionResponse)
def set_splits(transaction_id: int, body: TransactionSplitsUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """File the transaction across categories. Replaces any existing split.

    The lines must add up to the transaction exactly; the balance is not
    touched, because a split only changes how the amount is filed.
    """
    tx = _own_transaction(db, current_user.id, transaction_id)
    lines = [split_service.SplitLine(line.category_id, line.amount, line.note) for line in body.splits]
    try:
        split_service.replace(db, current_user.id, tx, lines)
        db.commit()
    except split_service.InvalidSplit as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc))
    except split_service.SplitCategoryNotFound:
        db.rollback()
        raise HTTPException(status_code=404, detail="Category not found")
    db.refresh(tx)
    return tx


@router.delete("/{transaction_id}/splits", response_model=TransactionResponse)
def clear_splits(transaction_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """File the whole transaction under its main category again."""
    tx = _own_transaction(db, current_user.id, transaction_id)
    split_service.clear(tx)
    db.commit()
    db.refresh(tx)
    return tx


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(transaction_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        LedgerService(db).delete_transaction(current_user.id, transaction_id)
    except LedgerResourceNotFound as error:
        raise _not_found(error) from error
