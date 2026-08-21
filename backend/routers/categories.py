from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List, Optional
from models.database import get_db, Category
from models.auth import User
from models.schemas import CategoryCreate, CategoryUpdate, CategoryResponse
from utils.auth import get_current_user
from utils.etag import check_etag, set_etag_headers
import hashlib

router = APIRouter(prefix="/categories", tags=["categories"])


def _categories_etag(db: Session, user_id: int) -> str:
    """Digest over both scopes the listing reads.

    The `user_id IS NULL` half is defensive rather than load-bearing: nothing
    in the app writes a category without an owner. Defaults are seeded *per
    user* with a real `user_id` and an `is_system` flag, which is why the owner
    filter alone never protected them from being edited.
    """
    row = (
        db.query(func.count(), func.max(Category.created_at), func.max(Category.updated_at))
        .filter(or_(Category.user_id == user_id, Category.user_id.is_(None)))
        .one()
    )
    payload = f"{user_id}|{row[0]}|{row[1]}|{row[2]}"
    return hashlib.md5(payload.encode(), usedforsecurity=False).hexdigest()[:20]


def _owned_category(db: Session, category_id: int, user_id: int) -> Category:
    category = (
        db.query(Category)
        .filter(Category.id == category_id, Category.user_id == user_id)
        .first()
    )
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    return category


def _reject_if_system(category: Category) -> None:
    """Default categories are read-only.

    They are seeded per user with a real `user_id` (see `seed_user_categories`),
    so the owner filter alone does **not** protect them — before this guard both
    endpoints matched and happily mutated them, despite the UI presenting them
    as defaults. 403 rather than 404: the row plainly exists and the caller can
    see it, so pretending otherwise would be the less honest answer.
    """
    if category.is_system:
        raise HTTPException(
            status_code=403,
            detail="Default categories cannot be changed. Create your own to customise.",
        )


def _assert_name_available(
    db: Session,
    user_id: int,
    name: str,
    category_type: str,
    exclude_id: Optional[int] = None,
) -> None:
    """One name per type per user, compared case-insensitively.

    Scoped to the *type* on purpose: an expense "Other" and an income "Other"
    are different categories and both are legitimate. Comparison is on the
    lower-cased name, and the schema has already trimmed it, so "Groceries",
    " groceries " and "GROCERIES" all collide inside one type.

    Enforced here rather than by a database constraint because existing
    accounts may already hold duplicates — `scripts/report_duplicate_categories.py`
    reports them, and no index is added until that has been reviewed.
    """
    query = db.query(Category.id).filter(
        Category.user_id == user_id,
        Category.type == category_type,
        func.lower(Category.name) == name.lower(),
    )
    if exclude_id is not None:
        query = query.filter(Category.id != exclude_id)
    if query.first():
        raise HTTPException(
            status_code=409,
            detail=f'You already have a {category_type} category called "{name}".',
        )


@router.post("/", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
def create_category(category: CategoryCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _assert_name_available(db, current_user.id, category.name, category.type)
    db_cat = Category(**category.model_dump(), user_id=current_user.id, is_system=False)
    db.add(db_cat)
    db.commit()
    db.refresh(db_cat)
    return db_cat


@router.get("/", response_model=List[CategoryResponse])
def get_categories(request: Request, response: Response, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    etag = _categories_etag(db, current_user.id)
    if check_etag(request, etag):
        return Response(status_code=304, headers={"ETag": f'W/"{etag}"', "Cache-Control": "private, no-cache"})
    set_etag_headers(response, etag)
    return (
        db.query(Category)
        .filter(or_(Category.user_id == current_user.id, Category.user_id.is_(None)))
        # Defaults first, then the user's own, alphabetically within each group
        # and case-insensitively so "gas" does not sort away from "Gas". The
        # type grouping is done by the client, which shows one type at a time.
        .order_by(
            Category.type,
            # `is_system` is nullable, and Postgres sorts NULLs first under
            # DESC — which would file a legacy null-flag row among the
            # defaults. Coalescing makes "unflagged" mean "custom".
            func.coalesce(Category.is_system, False).desc(),
            func.lower(Category.name),
        )
        .all()
    )


@router.put("/{category_id}", response_model=CategoryResponse)
def update_category(category_id: int, update: CategoryUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    cat = _owned_category(db, category_id, current_user.id)
    _reject_if_system(cat)

    fields = update.model_dump(exclude_unset=True)
    # A rename must not collide with another category of the same type, and a
    # retype must not collide under its new type — so both are resolved before
    # the check rather than checking against whichever half happened to change.
    new_name = fields.get("name", cat.name)
    new_type = fields.get("type", cat.type)
    if new_name.lower() != cat.name.lower() or new_type != cat.type:
        _assert_name_available(db, current_user.id, new_name, new_type, exclude_id=cat.id)

    for field, value in fields.items():
        setattr(cat, field, value)
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    cat = _owned_category(db, category_id, current_user.id)
    _reject_if_system(cat)
    # Transactions and recurring rows keep their history and fall back to
    # uncategorized: both foreign keys are ON DELETE SET NULL. Nothing is
    # reassigned to a different category, because a wrong category is worse
    # than none — it silently distorts every total the user reads.
    db.delete(cat)
    db.commit()
