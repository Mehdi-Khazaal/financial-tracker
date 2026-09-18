"""CSV import for transactions: preview, commit, undo."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models.auth import User
from models.database import Account, Transaction, get_db
from services import csv_import
from services.ledger import LedgerResourceNotFound, LedgerService
from utils.auth import get_current_user
from utils.limiter import limiter
from utils.logging import get_logger, kv

router = APIRouter(prefix="/transactions/import", tags=["transactions"])
logger = get_logger(__name__)


class ImportRequest(BaseModel):
    account_id: int
    # The file's text. Sent as JSON so the offline queue and the
    # Idempotency-Key middleware treat it like every other write.
    text: str = Field(min_length=1, max_length=csv_import.MAX_TEXT_BYTES)
    mapping: Optional[Dict[str, Optional[str]]] = None
    date_format: str = Field(default="auto", pattern="^(auto|ymd|mdy|dmy)$")
    # Bank exports that show money out as positive.
    flip_sign: bool = False
    include_duplicates: bool = False


class RowOut(BaseModel):
    row_number: int
    date: Optional[date]
    amount: Optional[Decimal]
    description: str
    category_name: str
    category_id: Optional[int]
    errors: List[str]
    duplicate: bool


class PreviewOut(BaseModel):
    headers: List[str]
    mapping: Dict[str, Optional[str]]
    total: int
    valid: int
    invalid: int
    duplicates: int
    sample: List[RowOut]


class ImportOut(BaseModel):
    batch_id: str
    created: int
    skipped_duplicates: int
    skipped_invalid: int


class UndoOut(BaseModel):
    removed: int


def _own_account(db: Session, user_id: int, account_id: int) -> Account:
    account = db.query(Account).filter(Account.id == account_id, Account.user_id == user_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


def _row_out(row: csv_import.ParsedRow) -> RowOut:
    return RowOut(
        row_number=row.row_number, date=row.date, amount=row.amount, description=row.description,
        category_name=row.category_name, category_id=row.category_id, errors=row.errors, duplicate=row.duplicate,
    )


def _preview(db: Session, user: User, body: ImportRequest) -> csv_import.Preview:
    _own_account(db, user.id, body.account_id)
    try:
        return csv_import.preview(
            db, user.id, body.text, account_id=body.account_id, mapping=body.mapping,
            date_format=body.date_format, flip_sign=body.flip_sign,
        )
    except csv_import.ImportError_ as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/preview", response_model=PreviewOut)
@limiter.limit("30/minute")
def preview_import(request: Request, body: ImportRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Parse and check the file. Writes nothing."""
    result = _preview(db, current_user, body)
    return PreviewOut(
        headers=result.headers, mapping=result.mapping, total=result.total, valid=result.valid,
        invalid=result.invalid, duplicates=result.duplicates, sample=[_row_out(r) for r in result.sample],
    )


@router.post("", response_model=ImportOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
def run_import(request: Request, body: ImportRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Post every valid, non-duplicate row through the ledger in one commit.

    Balances move exactly as for typed entries; categories come from the
    file's category column when it names one of the user's categories,
    otherwise from the same enrichment every other write gets.
    """
    result = _preview(db, current_user, body)
    batch_id = csv_import.new_batch_id()
    ledger = LedgerService(db)
    created = skipped_duplicates = 0
    try:
        for row in result.rows:
            if not row.ok:
                continue
            if row.duplicate and not body.include_duplicates:
                skipped_duplicates += 1
                continue
            ledger.stage_transaction(current_user.id, {
                "account_id": body.account_id,
                "category_id": row.category_id,
                "amount": row.amount,
                "description": row.description or None,
                "transaction_date": row.date,
                "import_batch_id": batch_id,
            })
            created += 1
        db.commit()
    except LedgerResourceNotFound as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=f"{exc} not found")
    except Exception:
        db.rollback()
        raise
    logger.info("csv_import %s", kv(user_id=current_user.id, batch_id=batch_id, created=created, skipped_duplicates=skipped_duplicates, invalid=result.invalid))
    return ImportOut(batch_id=batch_id, created=created, skipped_duplicates=skipped_duplicates, skipped_invalid=result.invalid)


@router.delete("/{batch_id}", response_model=UndoOut)
def undo_import(batch_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Remove every row of one import and put the balances back. One commit."""
    rows = (
        db.query(Transaction)
        .filter(Transaction.user_id == current_user.id, Transaction.import_batch_id == batch_id)
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Import not found")
    ledger = LedgerService(db)
    try:
        for row in rows:
            ledger.stage_delete(current_user.id, row)
        db.commit()
    except Exception:
        db.rollback()
        raise
    logger.info("csv_import_undone %s", kv(user_id=current_user.id, batch_id=batch_id, removed=len(rows)))
    return UndoOut(removed=len(rows))
