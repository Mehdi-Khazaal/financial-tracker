"""Categorization rules: the user's own "file this as that" instructions."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from models.auth import User
from models.database import CategorizationRule, get_db
from services import categorization_rules as rules_service
from utils.auth import get_current_user
from utils.etag import check_etag, compute_user_etag, set_etag_headers

router = APIRouter(prefix="/rules", tags=["rules"])


# ─── Schemas ──────────────────────────────────────────────────────────────────
class RuleBody(BaseModel):
    category_id: int
    field: str = "description"
    match_type: str = "contains"
    pattern: str = Field(min_length=1, max_length=rules_service.MAX_PATTERN_LENGTH)
    priority: int = Field(default=100, ge=0, le=10000)
    is_active: bool = True


class RuleUpdate(BaseModel):
    category_id: Optional[int] = None
    field: Optional[str] = None
    match_type: Optional[str] = None
    pattern: Optional[str] = Field(default=None, min_length=1, max_length=rules_service.MAX_PATTERN_LENGTH)
    priority: Optional[int] = Field(default=None, ge=0, le=10000)
    is_active: Optional[bool] = None


class RuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category_id: int
    field: str
    match_type: str
    pattern: str
    priority: int
    is_active: bool
    applied_count: int


class PreviewRowOut(BaseModel):
    id: int
    description: Optional[str]
    amount: Decimal
    transaction_date: date
    category_id: Optional[int]
    category_source: Optional[str]
    would_change: bool


class PreviewOut(BaseModel):
    matched: int
    would_change: int
    protected: int
    sample: List[PreviewRowOut]


class ApplyOut(BaseModel):
    changed: int


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _own_rule(db: Session, user_id: int, rule_id: int) -> CategorizationRule:
    row = (
        db.query(CategorizationRule)
        .filter(CategorizationRule.id == rule_id, CategorizationRule.user_id == user_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Rule not found")
    return row


def _check(db: Session, user_id: int, *, category_id: int, field: str, match_type: str, pattern: str) -> None:
    if not rules_service.category_belongs_to_user(db, user_id, category_id):
        raise HTTPException(status_code=404, detail="Category not found")
    try:
        rules_service.validate(field, match_type, pattern)
    except rules_service.InvalidRule as exc:
        raise HTTPException(status_code=422, detail=str(exc))


def _preview_out(result: rules_service.Preview) -> PreviewOut:
    return PreviewOut(
        matched=result.matched,
        would_change=result.would_change,
        protected=result.protected,
        sample=[PreviewRowOut(**row.__dict__) for row in result.sample],
    )


# ─── Routes ───────────────────────────────────────────────────────────────────
@router.get("/", response_model=List[RuleOut])
def list_rules(request: Request, response: Response, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    etag = compute_user_etag(db, current_user.id, [CategorizationRule])
    if check_etag(request, etag):
        return Response(status_code=304)
    set_etag_headers(response, etag)
    return (
        db.query(CategorizationRule)
        .filter(CategorizationRule.user_id == current_user.id)
        .order_by(CategorizationRule.priority.asc(), CategorizationRule.id.asc())
        .all()
    )


@router.post("/", response_model=RuleOut, status_code=status.HTTP_201_CREATED)
def create_rule(body: RuleBody, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _check(db, current_user.id, category_id=body.category_id, field=body.field, match_type=body.match_type, pattern=body.pattern)
    row = CategorizationRule(
        user_id=current_user.id,
        category_id=body.category_id,
        field=body.field,
        match_type=body.match_type,
        pattern=body.pattern.strip(),
        priority=body.priority,
        is_active=body.is_active,
        applied_count=0,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.post("/preview", response_model=PreviewOut)
def preview_rule(body: RuleBody, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """What an unsaved rule would hit. Reads only; nothing is written."""
    _check(db, current_user.id, category_id=body.category_id, field=body.field, match_type=body.match_type, pattern=body.pattern)
    compiled = rules_service.compile_rule(
        category_id=body.category_id, field=body.field, match_type=body.match_type, pattern=body.pattern, priority=body.priority,
    )
    return _preview_out(rules_service.preview(db, current_user.id, compiled))


@router.put("/{rule_id}", response_model=RuleOut)
def update_rule(rule_id: int, body: RuleUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = _own_rule(db, current_user.id, rule_id)
    changes = body.model_dump(exclude_unset=True)
    merged = {
        "category_id": changes.get("category_id", row.category_id),
        "field": changes.get("field", row.field),
        "match_type": changes.get("match_type", row.match_type),
        "pattern": (changes.get("pattern", row.pattern) or "").strip(),
    }
    _check(db, current_user.id, **merged)
    for key, value in merged.items():
        setattr(row, key, value)
    if "priority" in changes:
        row.priority = changes["priority"]
    if "is_active" in changes:
        row.is_active = changes["is_active"]
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(rule_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = _own_rule(db, current_user.id, rule_id)
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{rule_id}/apply", response_model=ApplyOut)
def apply_rule(rule_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """File past matches under the rule's category.

    Never touches a category the user chose by hand, and a second call finds
    nothing left to change. Balances are unaffected: only `category_id` moves.
    """
    row = _own_rule(db, current_user.id, rule_id)
    try:
        changed = rules_service.apply_to_past(db, current_user.id, row)
        db.commit()
    except rules_service.InvalidRule as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception:
        db.rollback()
        raise
    return ApplyOut(changed=changed)
