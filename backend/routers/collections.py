"""Collections: group transactions (a trip, a holiday, a move) and see what it cost."""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from models.auth import User
from models.database import Collection, Transaction, get_db
from models.schemas import TransactionResponse
from services import collections as collection_service
from utils.auth import get_current_user
from utils.dates import user_today

router = APIRouter(prefix="/collections", tags=["collections"])

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
MAX_AMOUNT = Decimal("9999999999999.99")


# ─── Schemas ──────────────────────────────────────────────────────────────────
def _clean_name(value: str) -> str:
    cleaned = " ".join(value.split())
    if not cleaned:
        raise ValueError("Give the collection a name.")
    return cleaned


def _clean_optional(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


class CollectionFields(BaseModel):
    emoji: Optional[str] = Field(default=None, max_length=16)
    color: Optional[str] = None
    note: Optional[str] = Field(default=None, max_length=500)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    budget: Optional[Decimal] = Field(default=None, gt=0, le=MAX_AMOUNT)

    @field_validator("emoji", "note")
    @classmethod
    def strip_text(cls, value: Optional[str]) -> Optional[str]:
        return _clean_optional(value)

    @field_validator("color")
    @classmethod
    def color_is_hex(cls, value: Optional[str]) -> Optional[str]:
        value = _clean_optional(value)
        if value is not None and not HEX_COLOR.match(value):
            raise ValueError("Color must look like #RRGGBB.")
        return value

    @field_validator("budget")
    @classmethod
    def two_places(cls, value: Optional[Decimal]) -> Optional[Decimal]:
        return value.quantize(Decimal("0.01")) if value is not None else None


class CollectionCreate(CollectionFields):
    name: str = Field(min_length=1, max_length=60)

    @field_validator("name")
    @classmethod
    def name_is_present(cls, value: str) -> str:
        return _clean_name(value)

    @model_validator(mode="after")
    def dates_in_order(self) -> "CollectionCreate":
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("The end date is before the start date.")
        if self.end_date and not self.start_date:
            raise ValueError("Add a start date too.")
        return self


class CollectionUpdate(CollectionFields):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    is_archived: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def name_is_present(cls, value: Optional[str]) -> Optional[str]:
        return None if value is None else _clean_name(value)


class CollectionTotalsOut(BaseModel):
    spent: Decimal
    returned: Decimal
    net: Decimal
    count: int
    first_date: Optional[date] = None
    last_date: Optional[date] = None


class CollectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    emoji: Optional[str] = None
    color: Optional[str] = None
    note: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    budget: Optional[Decimal] = None
    is_archived: bool
    created_at: Optional[datetime] = None
    active: bool
    suggestion_count: int
    totals: CollectionTotalsOut


class TransactionIds(BaseModel):
    transaction_ids: List[int] = Field(min_length=1, max_length=1000)


class AddResultOut(BaseModel):
    added: int
    already: int
    skipped_card_payments: int
    collection: CollectionOut


class RemoveResultOut(BaseModel):
    removed: int
    collection: CollectionOut


class SuggestionOut(BaseModel):
    transaction: TransactionResponse
    recommended: bool
    reason: Optional[str] = None


class ReviewBody(BaseModel):
    add_ids: List[int] = Field(default_factory=list, max_length=1000)


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _owned(db: Session, user: User, collection_id: int) -> Collection:
    try:
        return collection_service.owned_collection(db, user.id, collection_id)
    except collection_service.CollectionNotFound as error:
        raise HTTPException(status_code=404, detail="Collection not found") from error


def _check_name_free(db: Session, user: User, name: str, ignore_id: Optional[int] = None) -> None:
    query = db.query(Collection.id).filter(Collection.user_id == user.id, func.lower(Collection.name) == name.lower())
    if ignore_id is not None:
        query = query.filter(Collection.id != ignore_id)
    if query.first():
        raise HTTPException(status_code=409, detail="You already have a collection with this name.")


def _serialize(
    db: Session,
    user: User,
    row: Collection,
    totals: Optional[collection_service.Totals] = None,
    today: Optional[date] = None,
) -> CollectionOut:
    today = today or user_today(user)
    if totals is None:
        totals = collection_service.totals_by_collection(db, user.id).get(row.id, collection_service.Totals())
    suggestion_count = 0
    if not row.is_archived and row.start_date is not None:
        suggestion_count = sum(1 for s in collection_service.suggestions(db, user.id, row, today) if s.recommended)
    return CollectionOut(
        id=row.id,
        name=row.name,
        emoji=row.emoji,
        color=row.color,
        note=row.note,
        start_date=row.start_date,
        end_date=row.end_date,
        budget=row.budget,
        is_archived=bool(row.is_archived),
        created_at=row.created_at,
        active=collection_service.is_active(row, today),
        suggestion_count=suggestion_count,
        totals=CollectionTotalsOut(
            spent=totals.spent,
            returned=totals.returned,
            net=totals.net,
            count=totals.count,
            first_date=totals.first_date,
            last_date=totals.last_date,
        ),
    )


# ─── Routes ───────────────────────────────────────────────────────────────────
@router.get("/", response_model=List[CollectionOut])
def list_collections(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Every collection with its totals. Active ones first, then newest."""
    rows = db.query(Collection).filter(Collection.user_id == current_user.id).all()
    totals = collection_service.totals_by_collection(db, current_user.id)
    today = user_today(current_user)
    out = [_serialize(db, current_user, row, totals.get(row.id, collection_service.Totals()), today) for row in rows]

    def sort_key(item: CollectionOut):
        latest = item.end_date or item.totals.last_date or item.start_date or (item.created_at.date() if item.created_at else date.min)
        return (item.is_archived, not item.active, -latest.toordinal(), item.name.lower())

    return sorted(out, key=sort_key)


@router.post("/", response_model=CollectionOut, status_code=status.HTTP_201_CREATED)
def create_collection(body: CollectionCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _check_name_free(db, current_user, body.name)
    row = Collection(user_id=current_user.id, is_archived=False, **body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize(db, current_user, row)


@router.get("/{collection_id}", response_model=CollectionOut)
def get_collection(collection_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _serialize(db, current_user, _owned(db, current_user, collection_id))


@router.put("/{collection_id}", response_model=CollectionOut)
def update_collection(collection_id: int, body: CollectionUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = _owned(db, current_user, collection_id)
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes:
        if changes["name"] is None:
            raise HTTPException(status_code=422, detail="Give the collection a name.")
        _check_name_free(db, current_user, changes["name"], ignore_id=row.id)
    if "is_archived" in changes and changes["is_archived"] is None:
        changes.pop("is_archived")
    start = changes.get("start_date", row.start_date)
    end = changes.get("end_date", row.end_date)
    if end is not None and start is None:
        raise HTTPException(status_code=422, detail="Add a start date too.")
    if start is not None and end is not None and end < start:
        raise HTTPException(status_code=422, detail="The end date is before the start date.")
    for name, value in changes.items():
        setattr(row, name, value)
    db.commit()
    db.refresh(row)
    return _serialize(db, current_user, row)


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_collection(collection_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Delete the collection. Its transactions are not touched."""
    row = _owned(db, current_user, collection_id)
    db.delete(row)
    db.commit()


@router.post("/{collection_id}/transactions", response_model=AddResultOut)
def add_transactions(collection_id: int, body: TransactionIds, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = _owned(db, current_user, collection_id)
    try:
        result = collection_service.add_transactions(db, current_user.id, row, body.transaction_ids)
    except collection_service.TransactionNotFound as error:
        db.rollback()
        raise HTTPException(status_code=404, detail="Transaction not found") from error
    db.commit()
    db.refresh(row)
    return AddResultOut(
        added=result.added,
        already=result.already,
        skipped_card_payments=result.skipped_card_payments,
        collection=_serialize(db, current_user, row),
    )


@router.post("/{collection_id}/transactions/remove", response_model=RemoveResultOut)
def remove_transactions(collection_id: int, body: TransactionIds, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = _owned(db, current_user, collection_id)
    removed = collection_service.remove_transactions(db, current_user.id, row, body.transaction_ids)
    db.commit()
    db.refresh(row)
    return RemoveResultOut(removed=removed, collection=_serialize(db, current_user, row))


@router.get("/{collection_id}/suggestions", response_model=List[SuggestionOut])
def list_suggestions(
    collection_id: int,
    include_reviewed: bool = Query(False, alias="all"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Transactions in the collection's dates that might belong in it."""
    row = _owned(db, current_user, collection_id)
    found = collection_service.suggestions(db, current_user.id, row, user_today(current_user), include_reviewed)
    ids = [s.transaction.id for s in found]
    if ids:
        # Load splits and links for the whole page in two queries.
        db.query(Transaction).filter(Transaction.id.in_(ids)).options(
            selectinload(Transaction.splits), selectinload(Transaction.collection_links)
        ).all()
    return [SuggestionOut(transaction=s.transaction, recommended=s.recommended, reason=s.reason) for s in found]


@router.post("/{collection_id}/suggestions/review", response_model=AddResultOut)
def review_suggestions(collection_id: int, body: ReviewBody, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Add the ones the user picked and remember the rest were seen."""
    row = _owned(db, current_user, collection_id)
    try:
        result = collection_service.add_transactions(db, current_user.id, row, body.add_ids)
    except collection_service.TransactionNotFound as error:
        db.rollback()
        raise HTTPException(status_code=404, detail="Transaction not found") from error
    collection_service.mark_reviewed(row)
    db.commit()
    db.refresh(row)
    return AddResultOut(
        added=result.added,
        already=result.already,
        skipped_card_payments=result.skipped_card_payments,
        collection=_serialize(db, current_user, row),
    )
