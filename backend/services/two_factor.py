"""Two-factor authentication: TOTP enrolment, recovery codes, login step-up.

Storage:
* The authenticator secret is encrypted with `utils.secret_box` (the same
  Fernet key that protects Plaid access tokens) and never returned once
  enrolment is finished.
* Enrolment writes a *pending* secret first; nothing changes for the account
  until a code from the app proves the secret was captured correctly.
* Ten recovery codes, each usable once, stored as SHA-256 of the normalised
  code. They are 50-bit random strings, so a fast hash is enough — there is no
  password-sized search space to protect.
* `totp_last_step` records the time step of the last accepted code, so the
  same code cannot be replayed inside its validity window.

Login step-up: a correct password on a 2FA account yields a five-minute
challenge token instead of a session. The code is checked against its own
lockout counter (`2fa:<user id>`), so guessing codes locks out exactly like
guessing passwords.
"""

from __future__ import annotations

import hashlib
import io
import secrets
import base64
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from sqlalchemy.orm import Session

from models.auth import RecoveryCode, User
from utils import totp
from utils.auth import ALGORITHM, SECRET_KEY
from utils.secret_box import decrypt_secret, encrypt_secret

RECOVERY_CODE_COUNT = 10
_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"  # no 0/o/1/l/i
CHALLENGE_TTL = timedelta(minutes=5)
CHALLENGE_TYPE = "2fa_challenge"


def throttle_key(user_id: int) -> str:
    return f"2fa:{user_id}"


# ─── Recovery codes ───────────────────────────────────────────────────────────
def _hash_code(code: str) -> str:
    return hashlib.sha256(totp.normalize(code).lower().encode("utf-8")).hexdigest()


def _new_code() -> str:
    raw = "".join(secrets.choice(_ALPHABET) for _ in range(10))
    return f"{raw[:5]}-{raw[5:]}"


def issue_recovery_codes(db: Session, user: User) -> list[str]:
    """Replace every recovery code with ten new ones. Returns them in clear, once."""
    db.query(RecoveryCode).filter(RecoveryCode.user_id == user.id).delete(synchronize_session=False)
    codes = [_new_code() for _ in range(RECOVERY_CODE_COUNT)]
    for code in codes:
        db.add(RecoveryCode(user_id=user.id, code_hash=_hash_code(code)))
    return codes


def remaining_recovery_codes(db: Session, user: User) -> int:
    return db.query(RecoveryCode).filter(RecoveryCode.user_id == user.id, RecoveryCode.used_at.is_(None)).count()


def _use_recovery_code(db: Session, user: User, code: str) -> bool:
    row = (
        db.query(RecoveryCode)
        .filter(RecoveryCode.user_id == user.id, RecoveryCode.code_hash == _hash_code(code), RecoveryCode.used_at.is_(None))
        .first()
    )
    if row is None:
        return False
    row.used_at = datetime.now(timezone.utc).replace(tzinfo=None)
    return True


# ─── Codes ────────────────────────────────────────────────────────────────────
def check_code(db: Session, user: User, code: str, *, timestamp: Optional[float] = None) -> Optional[str]:
    """Accept a current app code or an unused recovery code. Stages the use.

    Returns "totp" or "recovery", or None when the code is not accepted.
    """
    if not user.totp_enabled or not user.totp_secret:
        return None
    step = totp.verify(decrypt_secret(user.totp_secret), code, timestamp=timestamp, last_step=user.totp_last_step)
    if step is not None:
        user.totp_last_step = step
        return "totp"
    if _use_recovery_code(db, user, code):
        return "recovery"
    return None


# ─── Enrolment ────────────────────────────────────────────────────────────────
def qr_data_uri(uri: str) -> str:
    """The provisioning URI as an SVG QR code, inline-safe as an <img> source."""
    import segno

    buffer = io.BytesIO()
    segno.make(uri, error="m").save(buffer, kind="svg", scale=5, border=2, dark="#0A0A0B", light="#EDEDEE", xmldecl=False)
    return "data:image/svg+xml;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def begin_setup(user: User) -> dict:
    secret = totp.new_secret()
    user.totp_pending_secret = encrypt_secret(secret)
    uri = totp.provisioning_uri(secret, user.email)
    return {"secret": totp.grouped(secret), "otpauth_uri": uri, "qr_svg": qr_data_uri(uri)}


def confirm_setup(db: Session, user: User, code: str, *, timestamp: Optional[float] = None) -> Optional[list[str]]:
    """Enable 2FA when `code` matches the pending secret. Returns the recovery codes."""
    if not user.totp_pending_secret:
        return None
    secret = decrypt_secret(user.totp_pending_secret)
    step = totp.verify(secret, code, timestamp=timestamp)
    if step is None:
        return None
    user.totp_secret = user.totp_pending_secret
    user.totp_pending_secret = None
    user.totp_enabled = True
    user.totp_last_step = step
    return issue_recovery_codes(db, user)


def disable(db: Session, user: User) -> None:
    user.totp_enabled = False
    user.totp_secret = None
    user.totp_pending_secret = None
    user.totp_last_step = None
    db.query(RecoveryCode).filter(RecoveryCode.user_id == user.id).delete(synchronize_session=False)


# ─── Login challenge ──────────────────────────────────────────────────────────
def issue_challenge(user: User, identifier: str) -> str:
    payload = {
        "sub": str(user.id),
        "sv": user.session_version,
        "ident": identifier.lower()[:320],
        "jti": secrets.token_urlsafe(12),
        "type": CHALLENGE_TYPE,
        "exp": datetime.now(timezone.utc) + CHALLENGE_TTL,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def read_challenge(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.InvalidTokenError:
        return None
    if payload.get("type") != CHALLENGE_TYPE:
        return None
    return payload
