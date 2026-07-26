from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List
from models.database import get_db, Category
from models.auth import User
from models.schemas import CategoryCreate, CategoryUpdate, CategoryResponse
from utils.auth import get_current_user
from utils.etag import check_etag, set_etag_headers
import hashlib

router = APIRouter(prefix="/categories", tags=["categories"])


def _categories_etag(db: Session, user_id: int) -> str:
    """Categories include user-owned rows AND global system rows (user_id NULL),
    so the default ETag helper doesn't fit — compute the digest over both scopes."""
    row = (
        db.query(func.count(), func.max(Category.created_at), func.max(Category.updated_at))
        .filter(or_(Category.user_id == user_id, Category.user_id.is_(None)))
        .one()
    )
    payload = f"{user_id}|{row[0]}|{row[1]}|{row[2]}"
    return hashlib.md5(payload.encode(), usedforsecurity=False).hexdigest()[:20]


@router.post("/", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
def create_category(category: CategoryCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
        .order_by(Category.type, Category.name)
        .all()
    )


@router.put("/{category_id}", response_model=CategoryResponse)
def update_category(category_id: int, update: CategoryUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    cat = db.query(Category).filter(Category.id == category_id, Category.user_id == current_user.id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found or not editable")
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(cat, field, value)
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    cat = db.query(Category).filter(Category.id == category_id, Category.user_id == current_user.id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found or not deletable")
    db.delete(cat)
    db.commit()
