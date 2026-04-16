from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from models.database import get_db
from models.push import PushSubscription
from models.auth import User
from utils.auth import get_current_user

router = APIRouter(prefix="/push", tags=["push"])


class SubscribeRequest(BaseModel):
    endpoint: str
    keys: dict


class UnsubscribeRequest(BaseModel):
    endpoint: str


@router.post("/subscribe", status_code=204)
def subscribe(body: SubscribeRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    existing = db.query(PushSubscription).filter(PushSubscription.endpoint == body.endpoint).first()
    if existing:
        existing.user_id = current_user.id
        existing.p256dh = body.keys.get("p256dh", "")
        existing.auth = body.keys.get("auth", "")
    else:
        db.add(PushSubscription(
            user_id=current_user.id,
            endpoint=body.endpoint,
            p256dh=body.keys.get("p256dh", ""),
            auth=body.keys.get("auth", ""),
        ))
    db.commit()


@router.post("/unsubscribe", status_code=204)
def unsubscribe(body: UnsubscribeRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.query(PushSubscription).filter(
        PushSubscription.endpoint == body.endpoint,
        PushSubscription.user_id == current_user.id,
    ).delete()
    db.commit()
