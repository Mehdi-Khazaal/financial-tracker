"""Read-only diagnostics: per-Item sync health and the recurring add-on probe."""

from typing import Optional

import requests
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from models.auth import User
from models.database import get_db
from routers import plaid_router as facade
from routers.plaid_router import _BASE_URLS, _safe_error
from routers.plaid_router.models import PlaidItem
from utils.auth import get_current_user
from utils.logging import get_logger, kv

router = APIRouter()
logger = get_logger(__name__)


# Render Free has no shell, so this endpoint is the only way to inspect why a
# connection is or is not syncing. It is strictly read-only and returns nothing
# that could authenticate anyone: no access token, no client id, no secret, and
# no raw Plaid payload — only the specific status fields needed to tell a
# webhook-registration problem from a delivery problem from an Item error.

WEBHOOK_MATCHES = "matches"
WEBHOOK_MISMATCHED = "mismatched"
WEBHOOK_NOT_REGISTERED = "not_registered"
WEBHOOK_UNKNOWN = "unknown"


def _classify_webhook(registered: Optional[str]) -> str:
    """Compare the Item's registered webhook against this deployment's."""
    if not facade.PLAID_WEBHOOK_URL:
        # We cannot judge a mismatch without knowing what we expect.
        return WEBHOOK_UNKNOWN
    if not registered:
        return WEBHOOK_NOT_REGISTERED
    return WEBHOOK_MATCHES if registered.strip() == facade.PLAID_WEBHOOK_URL.strip() else WEBHOOK_MISMATCHED


def _item_health(access_token: str) -> dict:
    """Read `/item/get` and keep only the diagnostic fields.

    Never raises — a failure to read health is itself a health result.
    """
    try:
        data = facade._plaid_post("/item/get", {"access_token": access_token})
    except Exception as exc:
        return {"reachable": False, "detail": _safe_error(exc)}

    item = data.get("item") or {}
    status = data.get("status") or {}
    transactions = status.get("transactions") or {}
    last_webhook = status.get("last_webhook") or {}
    error = item.get("error") or {}

    return {
        "reachable": True,
        # The whole point of the endpoint: what URL does Plaid actually have?
        "registered_webhook": item.get("webhook") or None,
        "webhook_status": _classify_webhook(item.get("webhook")),
        # Item-level error. Only the code and a safe display message; never the
        # full error object, which can carry request ids and causes.
        "item_error_code": error.get("error_code"),
        "item_error_type": error.get("error_type"),
        "login_repair_required": error.get("error_code") == "ITEM_LOGIN_REQUIRED",
        "consent_expiration_time": item.get("consent_expiration_time"),
        "plaid_last_successful_update": transactions.get("last_successful_update"),
        "plaid_last_failed_update": transactions.get("last_failed_update"),
        "plaid_last_webhook_sent_at": last_webhook.get("sent_at"),
        "plaid_last_webhook_code": last_webhook.get("code_sent"),
    }


@router.get("/sync-health")
def sync_health(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Per-institution sync diagnostics for the signed-in user's own Items."""
    items = db.query(PlaidItem).filter(PlaidItem.user_id == current_user.id).all()

    results = []
    for item in items:
        # Fintrack's own view — what we received and did.
        row = {
            # Fintrack's own row id, matching `PlaidItemResponse.id` from
            # `/plaid/items`, so a client can join the two lists and act on a
            # specific connection. Deliberately *not* `item.item_id`, which is
            # Plaid's identifier for the Item: this endpoint exposes no Plaid
            # identifiers, and naming the local key `item_id` here would collide
            # with that meaning everywhere else in the module.
            "id": item.id,
            "institution_name": item.institution_name,
            "connected_at": item.created_at.isoformat() if item.created_at else None,
            "cursor_initialized": bool(item.cursor),
            "fintrack_last_webhook_at": item.last_webhook_at.isoformat() if item.last_webhook_at else None,
            "fintrack_last_webhook_code": item.last_webhook_code,
            "last_sync_at": item.last_sync_at.isoformat() if item.last_sync_at else None,
            "last_sync_source": item.last_sync_source,
            "last_sync_ok": item.last_sync_ok,
            "last_sync_error": item.last_sync_error,
            "last_added_count": item.last_added_count,
            "last_modified_count": item.last_modified_count,
            "last_removed_count": item.last_removed_count,
        }
        # Plaid's view. One Item failing must not hide the others.
        try:
            row.update(_item_health(facade._item_access_token(db, item)))
        except Exception as exc:
            row.update({"reachable": False, "detail": _safe_error(exc)})
        results.append(row)

    try:
        db.commit()  # `_item_access_token` may re-encrypt a legacy token.
    except Exception:
        db.rollback()

    return {
        "environment": facade.PLAID_ENV,
        "expected_webhook_url": facade.PLAID_WEBHOOK_URL or None,
        "webhook_url_configured": bool(facade.PLAID_WEBHOOK_URL),
        "items": results,
    }


# ─── Recurring add-on capability probe ────────────────────────────────────────
# `/transactions/recurring/get` is an **optional add-on**. Holding the
# Transactions product does not imply access to it, so nothing may assume it
# works. This probe answers "is it available on this account, in this
# environment" without persisting anything — persisting streams is Phase 5B.
#
# Deliberately isolated from `_sync_item`: normal transaction sync must keep
# working unchanged when the add-on is absent.

# Plaid error codes that mean "not entitled", as distinct from a transient
# failure. Treated as a definitive "unavailable" answer rather than an error.
_RECURRING_UNAVAILABLE_CODES = {
    "PRODUCT_NOT_ENABLED",
    "PRODUCTS_NOT_SUPPORTED",
    "INVALID_PRODUCT",
    "ADDITION_LIMIT",
    "INSUFFICIENT_CREDENTIALS",
    "NOT_ENTITLED",
}

# The five states this probe can report. `transient_error` is deliberately
# distinct from `unavailable`: "Plaid is briefly unhappy" and "you are not
# entitled to this add-on" call for completely different responses, and
# collapsing them would make a temporary outage look like a permanent block.
CAPABILITY_AVAILABLE = "available"
CAPABILITY_NO_STREAMS = "available_no_streams"
CAPABILITY_UNAVAILABLE = "unavailable"
CAPABILITY_TRANSIENT_ERROR = "transient_error"
CAPABILITY_NOT_CONFIGURED = "not_configured"

# How long a single probe call may take. Bounded so a slow Plaid response
# cannot hold a request open indefinitely.
RECURRING_PROBE_TIMEOUT_SECONDS = 15


def _probe_recurring_for_item(access_token: str) -> dict:
    """One raw call to `/transactions/recurring/get`, classified.

    Returns a plain dict with no token or secret in it. Never raises — the
    caller is a diagnostic endpoint, and "Plaid is down" is a result, not a
    failure of the probe.
    """
    url = _BASE_URLS.get(facade.PLAID_ENV, _BASE_URLS["sandbox"]) + "/transactions/recurring/get"
    body = {"access_token": access_token, "client_id": facade.PLAID_CLIENT_ID, "secret": facade.PLAID_SECRET}
    try:
        resp = requests.post(url, json=body, timeout=RECURRING_PROBE_TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        return {"status": CAPABILITY_TRANSIENT_ERROR, "detail": f"Network error contacting Plaid: {type(exc).__name__}"}

    try:
        payload = resp.json()
    except ValueError:
        return {"status": CAPABILITY_TRANSIENT_ERROR, "detail": f"Non-JSON response (HTTP {resp.status_code})"}

    error_code = payload.get("error_code")
    if error_code:
        if error_code in _RECURRING_UNAVAILABLE_CODES:
            return {
                "status": CAPABILITY_UNAVAILABLE,
                "detail": "The recurring transactions add-on is not enabled for this Plaid account.",
                "plaid_error_code": error_code,
            }
        return {
            "status": CAPABILITY_TRANSIENT_ERROR,
            "detail": "Plaid returned an error. This may be transient.",
            "plaid_error_code": error_code,
        }

    if not resp.ok:
        return {"status": CAPABILITY_TRANSIENT_ERROR, "detail": f"HTTP {resp.status_code} from Plaid"}

    inflow = payload.get("inflow_streams") or []
    outflow = payload.get("outflow_streams") or []
    if not inflow and not outflow:
        return {
            "status": CAPABILITY_NO_STREAMS,
            "detail": "The add-on is enabled, but Plaid has not identified any recurring streams for this Item yet.",
            "inflow_streams": 0,
            "outflow_streams": 0,
        }

    return {
        "status": CAPABILITY_AVAILABLE,
        "detail": "The recurring transactions add-on is enabled and returning streams.",
        "inflow_streams": len(inflow),
        "outflow_streams": len(outflow),
    }


@router.get("/recurring-capability")
def check_recurring_capability(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Report whether the recurring add-on is usable, per connected bank.

    Diagnostic only — nothing is stored. Returns the institution name and a
    classified status per Item; access tokens and Plaid credentials never
    appear in the response.
    """
    if not facade.PLAID_CLIENT_ID or not facade.PLAID_SECRET:
        return {
            "environment": facade.PLAID_ENV,
            "overall": CAPABILITY_NOT_CONFIGURED,
            "detail": "Plaid credentials are not configured in this environment.",
            "items": [],
        }

    items = db.query(PlaidItem).filter(PlaidItem.user_id == current_user.id).all()
    if not items:
        return {
            "environment": facade.PLAID_ENV,
            "overall": CAPABILITY_NOT_CONFIGURED,
            "detail": "No banks are connected, so the add-on cannot be probed.",
            "items": [],
        }

    results = []
    for item in items:
        try:
            outcome = _probe_recurring_for_item(facade._item_access_token(db, item))
        except Exception as exc:
            outcome = {"status": CAPABILITY_TRANSIENT_ERROR, "detail": f"Probe failed: {type(exc).__name__}"}
        results.append({"institution_name": item.institution_name, **outcome})
    db.commit()  # `_item_access_token` may re-encrypt a legacy plaintext token.

    statuses = {row["status"] for row in results}
    if CAPABILITY_AVAILABLE in statuses:
        overall = CAPABILITY_AVAILABLE
    elif CAPABILITY_NO_STREAMS in statuses:
        overall = CAPABILITY_NO_STREAMS
    elif CAPABILITY_UNAVAILABLE in statuses:
        overall = CAPABILITY_UNAVAILABLE
    else:
        overall = CAPABILITY_TRANSIENT_ERROR

    logger.info(
        "plaid_recurring_capability_probe %s",
        kv(user_id=current_user.id, environment=facade.PLAID_ENV, overall=overall, items=len(results)),
    )
    return {"environment": facade.PLAID_ENV, "overall": overall, "items": results}
