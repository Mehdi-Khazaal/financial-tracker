"""Plaid integration — the package facade.

What lives here is deliberately the *shared* layer: environment
configuration, the one HTTP client every Plaid call goes through, the error
types that carry a specific recovery, and the sync-health writer. The routes
and the sync engine live in the submodules below and reach these through
`facade.<name>` at call time, which is why a test can patch
`routers.plaid_router._plaid_post` (or a `PLAID_*` setting) once and have it
apply everywhere.

Submodules:
- `models`       PlaidItem (the linked-bank row)
- `schemas`      request / response bodies
- `sync`         /accounts/get + /transactions/sync ingestion, background sync
- `items`        link tokens, exchange, list / disconnect / reset routes
- `diagnostics`  sync-health and the recurring add-on probe
- `webhook`      signed-webhook verification and dispatch
"""

import os
import re
from typing import Optional

import requests
from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import Session

from models.database import utc_now
from utils.logging import get_logger, kv
from utils.secret_box import decrypt_secret, encrypt_secret, is_encrypted

logger = get_logger(__name__)

PLAID_CLIENT_ID      = os.getenv("PLAID_CLIENT_ID", "")
PLAID_SECRET         = os.getenv("PLAID_SECRET", "")
PLAID_ENV            = os.getenv("PLAID_ENV", "sandbox").lower()
PLAID_WEBHOOK_URL    = os.getenv("PLAID_WEBHOOK_URL", "")

MAX_WEBHOOK_BYTES = 1_000_000
WEBHOOK_MAX_AGE_SECONDS = 5 * 60
WEBHOOK_KEY_CACHE_MAX_ENTRIES = 16

_BASE_URLS = {
    "sandbox":     "https://sandbox.plaid.com",
    "development": "https://development.plaid.com",
    "production":  "https://production.plaid.com",
}

# How much history to request when a *new* Item is linked. Plaid's documented
# maximum for `transactions.days_requested` is 730 days.
#
# Raised from 90 because recurring detection is bounded by it: three
# occurrences of a monthly charge need ~90 days with no margin, and a
# quarterly charge needs ~270. At 90 days a quarterly subscription is not
# detectable at all, by us or by Plaid.
#
# This applies only to Items linked from now on. Plaid fixes the history
# window when an Item is created, so **existing connections keep their 90-day
# window** and gain nothing until they are re-linked. Institutions also vary:
# many return less than the requested window, and some return as little as 30
# days regardless. Treat 730 as a ceiling, not a guarantee.
PLAID_DAYS_REQUESTED = 730

PLAID_TO_ACCOUNT_TYPE = {
    "checking":    "checking",
    "savings":     "savings",
    "credit card": "credit_card",
    "credit":      "credit_card",
    "loan":        "investment",
    "mortgage":    "investment",
    "other":       "checking",
}


# ─── Model and schemas ────────────────────────────────────────────────────────
from routers.plaid_router.models import PlaidItem  # noqa: E402
from routers.plaid_router.schemas import ExchangeTokenRequest, PlaidItemResponse  # noqa: E402


# Plaid raises this when the underlying data changes while a `/transactions/sync`
# pagination cycle is in flight. Its documented recovery is *not* to retry the
# failed page: the whole loop must restart from the cursor the cycle began
# with, because intermediate cursors from a mutated cycle are not valid.
PLAID_MUTATION_DURING_PAGINATION = "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"

# How many times a single sync will restart its pagination cycle before giving
# up. Bounded so a persistently churning account cannot spin forever; three
# restarts is generous for a condition that resolves as soon as the account
# settles.
MAX_PAGINATION_RESTARTS = 3


class PlaidMutationDuringPagination(Exception):
    """Plaid mutated the dataset mid-pagination; the cycle must restart."""


# Plaid documents this as: "The Item you requested cannot be found. This Item
# does not exist, has been previously removed via /item/remove, or has had
# access removed by the user."
#
# That makes it *terminal proof* the remote Item is gone, which is the one
# error Disconnect may safely treat as equivalent to a successful removal.
# Notably `INVALID_ACCESS_TOKEN` is **not** such a proof — a token can be
# malformed or expired while the Item is very much alive — so it is not
# treated this way.
PLAID_ITEM_NOT_FOUND = "ITEM_NOT_FOUND"


class PlaidItemNotFound(HTTPException):
    """Plaid says this Item no longer exists.

    Subclasses `HTTPException` deliberately: every existing caller catches or
    propagates that and keeps behaving exactly as before, while Disconnect can
    catch this narrower type and finish its local cleanup. Adding a bare
    `Exception` here would turn today's 502 into a 500 for callers that never
    asked about this case.
    """

    def __init__(self) -> None:
        super().__init__(status_code=502, detail="Plaid returned an error")


# ─── Plaid API helper ─────────────────────────────────────────────────────────
def _plaid_post(path: str, body: dict) -> dict:
    url = _BASE_URLS.get(PLAID_ENV, _BASE_URLS["sandbox"]) + path
    body = {**body, "client_id": PLAID_CLIENT_ID, "secret": PLAID_SECRET}
    try:
        resp = requests.post(url, json=body, timeout=30)
    except requests.RequestException as exc:
        logger.warning("plaid_request_failed %s", kv(path=path, error=_scrub_secrets(str(exc))))
        raise HTTPException(status_code=502, detail="Plaid is temporarily unavailable")
    if not resp.ok:
        logger.warning("plaid_response_error %s", kv(path=path, status_code=resp.status_code))
        raise HTTPException(status_code=502, detail="Plaid returned an error")
    try:
        data = resp.json()
    except ValueError:
        logger.warning("plaid_invalid_response %s", kv(path=path))
        raise HTTPException(status_code=502, detail="Plaid returned an invalid response")
    if data.get("error_code"):
        error_code = data.get("error_code")
        logger.warning("plaid_api_error %s", kv(path=path, error_code=error_code))
        # Surfaced as its own type because it has a *specific* required
        # recovery — restart pagination from the original cursor — rather
        # than the generic "Plaid is unhappy" 502 everything else gets.
        if error_code == PLAID_MUTATION_DURING_PAGINATION:
            raise PlaidMutationDuringPagination(error_code)
        # Same reasoning: a specific recovery rather than the generic 502.
        # Disconnect finishes locally on this one; nothing else changes,
        # because it *is* a 502 to anyone not looking for it.
        if error_code == PLAID_ITEM_NOT_FOUND:
            raise PlaidItemNotFound()
        raise HTTPException(status_code=502, detail="Plaid returned an error")
    return data


def _item_access_token(db: Session, item: PlaidItem) -> str:
    token = decrypt_secret(item.access_token)
    if not is_encrypted(item.access_token):
        item.access_token = encrypt_secret(token)
        db.flush()
    return token


SYNC_SOURCE_WEBHOOK = "webhook"
SYNC_SOURCE_MANUAL = "manual"
SYNC_SOURCE_OTHER = "other"

# Error text is truncated before storage. The column is diagnostic, not a log
# sink, and an unbounded exception string could carry a URL or payload
# fragment we have no reason to keep.
_MAX_STORED_ERROR = 280


# Plaid credential shapes. Nothing in this module should ever log or store
# one, but an exception message from a lower layer (a URL echoed back, a
# request body in a library error) might carry it, so every string that is
# logged or stored passes through `_scrub_secrets` first.
_PLAID_SECRET_PATTERN = re.compile(
    r"(?:access|public|link)-(?:sandbox|development|production)-[0-9a-zA-Z-]+"
)


def _scrub_secrets(text: str) -> str:
    text = _PLAID_SECRET_PATTERN.sub("<redacted-plaid-token>", text)
    if PLAID_SECRET and PLAID_SECRET in text:
        text = text.replace(PLAID_SECRET, "<redacted-plaid-secret>")
    return text


def _safe_error(exc: BaseException) -> str:
    """A short, credential-free description of a failure."""
    return _scrub_secrets(f"{type(exc).__name__}: {exc}")[:_MAX_STORED_ERROR]


def record_sync_health(
    db: Session,
    item: PlaidItem,
    *,
    source: str,
    ok: bool,
    error: Optional[str] = None,
    added: Optional[int] = None,
    modified: Optional[int] = None,
    removed: Optional[int] = None,
) -> None:
    """Best-effort health write. Swallows everything.

    Observability must never be able to break the thing it observes: if this
    write fails, the sync it describes has already succeeded and committed,
    and losing a diagnostic column is strictly better than failing the sync.
    Uses its own nested transaction so a failure here cannot poison the
    caller's session.
    """
    try:
        item.last_sync_at = utc_now()
        item.last_sync_source = source
        item.last_sync_ok = ok
        item.last_sync_error = None if ok else (error or "")[:_MAX_STORED_ERROR]
        if added is not None:
            item.last_added_count = added
        if modified is not None:
            item.last_modified_count = modified
        if removed is not None:
            item.last_removed_count = removed
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        logger.warning("plaid_sync_health_write_failed %s", kv(item_id=item.id))


# ─── Package assembly ─────────────────────────────────────────────────────────
# The submodules are imported *after* everything above is defined, because
# they bind the client, the config and the health helpers through this module
# (`facade.<name>`) — that is what keeps the tests' monkeypatches on
# `routers.plaid_router` effective and the behaviour byte-for-byte unchanged.
from routers.plaid_router.sync import (  # noqa: E402
    _apply_metadata,
    _apply_pending_replacement,
    _do_sync_and_notify,
    _local_balance,
    _match_local_account,
    _optional_date,
    _plaid_amount,
    _plaid_description,
    _plaid_metadata,
    _posted_row,
    _reconcile_recurring,
    _sync_item,
    _uniform_rows,
)
from routers.plaid_router.items import _owned_item, router as _items_router  # noqa: E402
from routers.plaid_router.diagnostics import (  # noqa: E402
    CAPABILITY_AVAILABLE,
    CAPABILITY_NO_STREAMS,
    CAPABILITY_NOT_CONFIGURED,
    CAPABILITY_TRANSIENT_ERROR,
    CAPABILITY_UNAVAILABLE,
    RECURRING_PROBE_TIMEOUT_SECONDS,
    WEBHOOK_MATCHES,
    WEBHOOK_MISMATCHED,
    WEBHOOK_NOT_REGISTERED,
    WEBHOOK_UNKNOWN,
    _classify_webhook,
    _item_health,
    _probe_recurring_for_item,
    router as _diagnostics_router,
)
from routers.plaid_router.webhook import (  # noqa: E402
    _get_plaid_verification_key,
    _verify_plaid_webhook,
    _webhook_key_cache,
    _webhook_key_cache_lock,
    router as _webhook_router,
)

router = APIRouter(prefix="/plaid", tags=["plaid"])
router.include_router(_items_router)
router.include_router(_diagnostics_router)
router.include_router(_webhook_router)

__all__ = [name for name in dir() if not name.startswith("__")]
