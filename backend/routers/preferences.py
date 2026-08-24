"""Per-user preferences — read and partially update.

Small on purpose. This route exposes exactly the settings a user is allowed to
change about their own account, and nothing else:

* **Current user only.** There is no id in the path and no admin override; an
  admin editing someone else's preferences would need a different, deliberate
  endpoint, not a query parameter on this one.
* **No unknown keys.** `PreferencesUpdate` forbids extras, so a typo or a
  client sending a field this version does not know is a 422 rather than a
  silent no-op that looks like it worked.
* **Operator switches are not editable.** `AUTO_CATEGORIZE` is deployment
  configuration, so it appears here only as the read-only `..._effective`
  field, which exists so the UI can explain a disabled switch instead of
  showing one that does nothing.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from models.auth import User
from models.database import get_db
from models.schemas import PreferencesResponse, PreferencesUpdate
from services import user_preferences
from services.transaction_enrichment import auto_categorize_enabled
from utils.auth import get_current_user
from utils.logging import get_logger, kv

router = APIRouter(prefix="/preferences", tags=["preferences"])
logger = get_logger(__name__)


def _payload(db: Session, user_id: int) -> dict:
    """Stored values plus what they actually amount to right now."""
    stored = user_preferences.stored_values(db, user_id)
    return {
        **stored,
        # `global AND user`. Shown separately rather than folded into the
        # stored value, so switching the operator kill-switch back on restores
        # each user's own choice instead of having overwritten it.
        "automatic_categorization_effective": (
            stored["automatic_categorization_enabled"] and auto_categorize_enabled()
        ),
    }


@router.get("", response_model=PreferencesResponse)
def read_preferences(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Never 404s. A user with no row has defaults, not an absence."""
    return _payload(db, current_user.id)


@router.patch("", response_model=PreferencesResponse)
def update_preferences(
    update: PreferencesUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    changes = update.model_dump(exclude_unset=True)
    if not changes:
        # Nothing asked for, so nothing written — and no empty row created for
        # a request that changed nothing.
        return _payload(db, current_user.id)

    try:
        user_preferences.upsert(db, current_user.id, changes)
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error(
            "preferences_update_failed %s",
            kv(user_id=current_user.id, error_type=type(exc).__name__),
        )
        raise HTTPException(status_code=500, detail="Could not save your preferences.")

    logger.info(
        "preferences_updated %s",
        kv(user_id=current_user.id, fields=",".join(sorted(changes))),
    )
    return _payload(db, current_user.id)
