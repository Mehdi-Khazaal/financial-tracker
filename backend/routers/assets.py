from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from models.database import get_db, Asset
from models.schemas import AssetCreate, AssetUpdate, AssetResponse
from models.auth import User
from utils.auth import get_current_user

router = APIRouter(prefix="/assets", tags=["assets"])

@router.post("/", response_model=AssetResponse, status_code=status.HTTP_201_CREATED)
def create_asset(asset: AssetCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_asset = Asset(**asset.dict(), user_id=current_user.id)
    db.add(db_asset)
    db.commit()
    db.refresh(db_asset)
    return db_asset

@router.get("/", response_model=List[AssetResponse])
def get_assets(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    assets = db.query(Asset).filter(Asset.user_id == current_user.id).offset(skip).limit(limit).all()
    return assets

@router.get("/{asset_id}", response_model=AssetResponse)
def get_asset(asset_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.user_id == current_user.id).first()
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset

@router.put("/{asset_id}", response_model=AssetResponse)
def update_asset(asset_id: int, asset_update: AssetUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_asset = db.query(Asset).filter(Asset.id == asset_id, Asset.user_id == current_user.id).first()
    if db_asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    
    update_data = asset_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_asset, key, value)
    
    db.commit()
    db.refresh(db_asset)
    return db_asset

@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(asset_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_asset = db.query(Asset).filter(Asset.id == asset_id, Asset.user_id == current_user.id).first()
    if db_asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    
    db.delete(db_asset)
    db.commit()
    return None

