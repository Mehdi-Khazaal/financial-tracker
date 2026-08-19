from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from typing import List
from models.database import get_db
from models.auth import User, UserResponse
from utils.auth import get_current_user, create_reset_token
from utils.email import send_password_reset
from utils.limiter import limiter
from utils.logging import get_logger, kv

router = APIRouter(prefix="/admin", tags=["admin"])
logger = get_logger(__name__)


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


@router.get("/users", response_model=List[UserResponse])
def list_users(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return db.query(User).order_by(User.created_at).all()


@router.post("/users/{user_id}/reset-password")
@limiter.limit("3/minute")
def admin_reset_password(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(require_admin),
):
    """Email a password reset link to a user, on an admin's behalf.

    Deliberately does **not** set a password. The admin never learns, chooses,
    or transmits password material — they trigger the same emailed-token flow
    the user could start themselves. Nothing here invalidates the target's
    current sessions either: revocation happens when the *user* completes the
    reset and `session_version` moves, so an admin cannot sign someone out of
    every device without their involvement.

    Rate limited to match `/auth/forgot-password`; both send mail to an address
    the caller supplies by reference, and neither should be an unbounded sender.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    token = create_reset_token(user.id, user.session_version)
    send_password_reset(user.email, token)
    # Identifiers only. The token, the message body and anything derived from
    # the password are deliberately absent — a log line is not a place to put
    # credential material, and this one exists to answer "who triggered this",
    # which ids alone answer.
    logger.info(
        "admin_password_reset_requested %s",
        kv(actor_user_id=actor.id, target_user_id=user.id),
    )
    return {"message": f"Password reset email sent to {user.email}"}
