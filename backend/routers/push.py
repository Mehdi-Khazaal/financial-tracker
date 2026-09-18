import ipaddress
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, field_validator
from models.database import get_db
from models.push import PushSubscription
from models.auth import User
from utils.auth import get_current_user

router = APIRouter(prefix="/push", tags=["push"])

MAX_ENDPOINT_LENGTH = 2048
MAX_KEY_LENGTH = 512


def validate_push_endpoint(value: str) -> str:
    """Accept only a URL the server may safely POST to.

    The endpoint is stored and later used verbatim by `pywebpush`, which means
    the *server* makes an outbound request to whatever is written here. Left
    unchecked, an authenticated user could point it at an internal address or
    an arbitrary host. Browser push services are always public HTTPS hosts,
    so that is all that is allowed: no plain HTTP, no credentials in the URL,
    no IP literals, no loopback or private ranges.
    """
    if not isinstance(value, str):
        raise ValueError("endpoint must be a URL")
    value = value.strip()
    if not value or len(value) > MAX_ENDPOINT_LENGTH:
        raise ValueError("endpoint is missing or too long")
    parts = urlsplit(value)
    if parts.scheme != "https":
        raise ValueError("endpoint must use https")
    if not parts.hostname or parts.username or parts.password:
        raise ValueError("endpoint must be a plain https URL")
    host = parts.hostname.lower()
    if host in {"localhost"} or host.endswith(".localhost") or host.endswith(".local"):
        raise ValueError("endpoint host is not allowed")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None:
        # An IP literal is never a browser push service; refusing every one
        # is simpler and safer than enumerating private ranges.
        raise ValueError("endpoint host must be a domain name")
    if "." not in host:
        raise ValueError("endpoint host must be a public domain")
    return value


class SubscribeRequest(BaseModel):
    endpoint: str = Field(max_length=MAX_ENDPOINT_LENGTH)
    keys: dict

    @field_validator("endpoint")
    @classmethod
    def endpoint_is_safe(cls, value: str) -> str:
        return validate_push_endpoint(value)

    @field_validator("keys")
    @classmethod
    def keys_are_present(cls, value: dict) -> dict:
        for name in ("p256dh", "auth"):
            key = value.get(name)
            if not isinstance(key, str) or not key.strip() or len(key) > MAX_KEY_LENGTH:
                raise ValueError(f"keys.{name} is required")
        return value


class UnsubscribeRequest(BaseModel):
    endpoint: str = Field(min_length=1, max_length=MAX_ENDPOINT_LENGTH)


@router.post("/subscribe", status_code=204)
def subscribe(body: SubscribeRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    existing = db.query(PushSubscription).filter(PushSubscription.endpoint == body.endpoint).first()
    if existing:
        # A push endpoint is unique to one browser profile. If a different
        # account signs in on the same device, the subscription follows it —
        # the previous user must not keep receiving this device's alerts.
        existing.user_id = current_user.id
        existing.p256dh = body.keys["p256dh"]
        existing.auth = body.keys["auth"]
    else:
        db.add(PushSubscription(
            user_id=current_user.id,
            endpoint=body.endpoint,
            p256dh=body.keys["p256dh"],
            auth=body.keys["auth"],
        ))
    db.commit()


@router.post("/unsubscribe", status_code=204)
def unsubscribe(body: UnsubscribeRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.query(PushSubscription).filter(
        PushSubscription.endpoint == body.endpoint,
        PushSubscription.user_id == current_user.id,
    ).delete()
    db.commit()
