"""Connection lifecycle routes: Link tokens, exchange, list, disconnect,
remove-local, sync, sync-status, replay and reset."""

from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from models.auth import User
from models.database import Account, Transaction, get_db
from routers import plaid_router as facade
from routers.plaid_router import (
    PLAID_DAYS_REQUESTED,
    PLAID_TO_ACCOUNT_TYPE,
    SYNC_SOURCE_MANUAL,
    PlaidItemNotFound,
)
from routers.plaid_router.models import PlaidItem
from routers.plaid_router.schemas import ExchangeTokenRequest, PlaidItemResponse
from routers.plaid_router.sync import _local_balance, _match_local_account
from utils.auth import get_current_user
from utils.logging import get_logger, kv
from utils.secret_box import encrypt_secret

router = APIRouter()
logger = get_logger(__name__)


@router.post("/link-token")
def create_link_token(current_user: User = Depends(get_current_user)):
    body: dict = {
        "user":          {"client_user_id": str(current_user.id)},
        "client_name":   "Financial Tracker",
        "products":      ["transactions"],
        "country_codes": ["US"],
        "language":      "en",
        "transactions":  {"days_requested": PLAID_DAYS_REQUESTED},
    }
    if facade.PLAID_WEBHOOK_URL:
        body["webhook"] = facade.PLAID_WEBHOOK_URL
    data = facade._plaid_post("/link/token/create", body)
    return {"link_token": data["link_token"]}


@router.post("/link-token/update/{item_id}")
def create_update_link_token(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """A Link token that *repairs* an existing Item rather than creating one.

    Plaid calls this update mode. It is the only correct response to
    `ITEM_LOGIN_REQUIRED`: sending the user through the ordinary Connect flow
    would mint a second Item for the same institution — and `exchange_token`
    rejects that with "already connected", leaving them with a broken
    connection and no way out except Disconnect or Reset.

    Per Plaid's documented contract for update mode:

      * `access_token` identifies the Item to repair;
      * **`products` is omitted entirely.** Passing it in update mode is an
        error unless adding a product, which this is not;
      * `user.client_user_id`, `country_codes` and `language` are still
        required, and match the new-Item flow so the experience is identical;
      * `webhook` may be included, and is, so a repaired Item keeps sending to
        this deployment.

    Nothing here mutates anything. The Item's `access_token` does not change
    when Link is used in update mode, so there is no exchange-token step
    afterwards — the caller just re-syncs and the error clears. `item_id` is
    Fintrack's own row id, matching `/plaid/items`, not Plaid's Item id.
    """
    item = (
        db.query(PlaidItem)
        .filter(PlaidItem.id == item_id, PlaidItem.user_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    body: dict = {
        "user":          {"client_user_id": str(current_user.id)},
        "client_name":   "Financial Tracker",
        "country_codes": ["US"],
        "language":      "en",
        # Reuses the shared helper rather than decrypting inline, so there is
        # one decryption path. It may re-encrypt a legacy plaintext token and
        # flush, but `get_db` never commits, so nothing is persisted here.
        "access_token":  facade._item_access_token(db, item),
    }
    if facade.PLAID_WEBHOOK_URL:
        body["webhook"] = facade.PLAID_WEBHOOK_URL

    data = facade._plaid_post("/link/token/create", body)
    # Only what Link needs plus what the caller already knows. No access token,
    # no Plaid Item id, no expiry secrets.
    return {
        "link_token": data["link_token"],
        "id": item.id,
        "institution_name": item.institution_name,
    }


@router.post("/exchange-token")
def exchange_token(
    body: ExchangeTokenRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data         = facade._plaid_post("/item/public_token/exchange", {"public_token": body.public_token})
    access_token = data["access_token"]
    item_id      = data["item_id"]

    if db.query(PlaidItem).filter(PlaidItem.item_id == item_id).first():
        raise HTTPException(status_code=400, detail="This bank is already connected.")

    institution_name = body.institution_name
    if not institution_name:
        try:
            item_data = facade._plaid_post("/item/get", {"access_token": access_token})
            inst_id = item_data["item"].get("institution_id")
            if inst_id:
                inst_data = facade._plaid_post("/institutions/get_by_id", {
                    "institution_id": inst_id,
                    "country_codes":  ["US"],
                })
                institution_name = inst_data["institution"]["name"]
        except Exception as exc:
            logger.info(
                "plaid_institution_lookup_failed %s",
                kv(user_id=current_user.id, error_type=type(exc).__name__),
            )
        institution_name = institution_name or "Bank"

    if db.query(PlaidItem).filter(
        PlaidItem.user_id == current_user.id,
        PlaidItem.institution_name == institution_name,
    ).first():
        raise HTTPException(status_code=400, detail=f"{institution_name} is already connected.")

    item = PlaidItem(
        user_id=current_user.id,
        access_token=encrypt_secret(access_token),
        item_id=item_id,
        institution_name=institution_name,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    # Create a local account for each Plaid account, keyed by plaid_account_id
    acct_data = facade._plaid_post("/accounts/get", {"access_token": access_token})
    for acct in acct_data.get("accounts", []):
        plaid_acct_id = acct["account_id"]
        acct_name     = acct.get("official_name") or acct.get("name") or institution_name
        acct_type     = PLAID_TO_ACCOUNT_TYPE.get((acct.get("subtype") or "other").lower(), "checking")
        balance       = _local_balance(acct["balances"], acct_type == "credit_card")

        existing = _match_local_account(db, current_user.id, plaid_acct_id, acct_name)

        if existing:
            existing.plaid_account_id = plaid_acct_id
            existing.balance = Decimal(str(balance))
        else:
            db.add(Account(
                user_id=current_user.id,
                name=acct_name,
                type=acct_type,
                balance=balance,
                currency="USD",
                plaid_account_id=plaid_acct_id,
            ))

    db.commit()
    background.add_task(facade._do_sync_and_notify, item.id, current_user.id, SYNC_SOURCE_MANUAL)
    return {"message": f"{institution_name} connected successfully.", "item_id": item_id}


@router.get("/items", response_model=list[PlaidItemResponse])
def list_items(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(PlaidItem).filter(PlaidItem.user_id == current_user.id).all()


def _owned_item(db: Session, item_id: int, user_id: int) -> PlaidItem:
    item = (
        db.query(PlaidItem)
        .filter(PlaidItem.id == item_id, PlaidItem.user_id == user_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.delete("/items/{item_id}")
def disconnect_item(item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Remove the connection at Plaid first, and only then locally.

    This used to swallow a failed `/item/remove`, delete the local row anyway
    and report success — which could leave a live Item at Plaid with the only
    record capable of reconciling it destroyed. The remote call now gates the
    local delete.

    `ITEM_NOT_FOUND` is the one error treated as success, because Plaid
    documents it as meaning the Item "does not exist, has been previously
    removed via /item/remove, or has had access removed by the user". That is
    terminal proof there is nothing left to remove. Every other failure keeps
    the row so the user can retry — including an invalid access token, which
    says the *token* is unusable and proves nothing about the Item.

    Historical data is untouched, exactly as before: accounts, transactions,
    categories, merchant history, recurring records and balances all survive.
    Disconnect stops future updates; it is not Reset.
    """
    item = _owned_item(db, item_id, current_user.id)

    try:
        facade._plaid_post("/item/remove", {"access_token": facade._item_access_token(db, item)})
    except PlaidItemNotFound:
        # Already gone at Plaid. Finishing locally is the correct outcome, and
        # is also how a previous remote-success/local-failure run recovers.
        logger.info(
            "plaid_disconnect_item_already_removed %s",
            kv(item_id=item.id, user_id=current_user.id),
        )
    except Exception as exc:
        logger.warning(
            "plaid_remote_disconnect_failed %s",
            kv(item_id=item.id, user_id=current_user.id, error_type=type(exc).__name__),
        )
        raise HTTPException(
            status_code=502,
            detail="Could not disconnect this bank with Plaid. Nothing was changed — try again.",
        )

    try:
        db.delete(item)
        db.commit()
    except Exception as exc:
        db.rollback()
        # The awkward one: gone at Plaid, still here locally. Deliberately no
        # extra state is recorded to recover it — retrying is the recovery,
        # because the retry's `/item/remove` returns ITEM_NOT_FOUND and the
        # branch above finishes the local delete. Saying so plainly beats
        # inventing a reconciliation job for a case a second click resolves.
        logger.error(
            "plaid_disconnect_local_delete_failed %s",
            kv(item_id=item.id, user_id=current_user.id, error_type=type(exc).__name__),
        )
        raise HTTPException(
            status_code=500,
            detail=(
                "This bank was disconnected at Plaid, but Fintrack could not finish "
                "removing it. Try again to complete it."
            ),
        )

    return {"message": "Bank disconnected."}


@router.post("/items/{item_id}/remove-local")
def remove_item_locally(item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Forget the connection locally **without** contacting Plaid.

    A recovery escape hatch, not the normal path: it exists for an Item whose
    remote removal cannot be made to succeed, so a user is not stuck with a
    connection they can never clear now that Disconnect refuses to lie.

    It makes no Plaid call at all, and therefore cannot and does not claim the
    remote Item was removed. The response says so, and the client repeats it in
    a stronger confirmation. Historical data is preserved on the same terms as
    an ordinary disconnect.
    """
    item = _owned_item(db, item_id, current_user.id)

    logger.warning(
        "plaid_item_removed_locally_without_remote_confirmation %s",
        kv(item_id=item.id, user_id=current_user.id),
    )
    db.delete(item)
    db.commit()
    return {
        "message": "Connection removed from Fintrack. Plaid removal was not confirmed.",
        "remote_removal_confirmed": False,
    }


@router.post("/sync")
def sync_all(
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    items = db.query(PlaidItem).filter(PlaidItem.user_id == current_user.id).all()
    if not items:
        raise HTTPException(status_code=404, detail="No connected banks.")
    for item in items:
        background.add_task(facade._do_sync_and_notify, item.id, current_user.id, SYNC_SOURCE_MANUAL)
    return {"message": f"Syncing {len(items)} bank(s) in background."}


@router.get("/sync-status")
def sync_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Local sync progress. **Makes no Plaid call at all.**

    `/plaid/sync-health` is the rich diagnostic, and it costs one live
    `/item/get` per Item — fine for opening a page, ruinous as a completion
    loop. This endpoint reads only the `plaid_items` observability columns, so
    a client can poll it every few seconds while a manual sync runs without
    generating any Plaid traffic whatsoever.

    That distinction is the entire reason it exists, so it deliberately does
    not reuse any helper that touches Plaid: adding one later would silently
    turn a cheap poll into a rate-limit problem.

    Nothing here is a credential or an identifier the client has no use for —
    no access token, no cursor, no Plaid Item id, no webhook URL. `id` is
    Fintrack's own row id, matching `/plaid/items`, which is what the caller
    needs to tell one connection's progress from another's.
    """
    items = (
        db.query(PlaidItem)
        .filter(PlaidItem.user_id == current_user.id)
        .order_by(PlaidItem.id)
        .all()
    )
    return {
        "items": [
            {
                "id": item.id,
                "institution_name": item.institution_name,
                "last_sync_at": item.last_sync_at.isoformat() if item.last_sync_at else None,
                "last_sync_ok": item.last_sync_ok,
                "last_sync_error": item.last_sync_error,
                "last_sync_source": item.last_sync_source,
                "last_added_count": item.last_added_count,
                "last_modified_count": item.last_modified_count,
                "last_removed_count": item.last_removed_count,
            }
            for item in items
        ]
    }


@router.post("/replay")
def replay_all_transactions(
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Clear every cursor so the next sync re-reads all available history.

    Surfaced as "Rebuild bank history". Non-destructive, and specifically:

    * A null cursor makes `/transactions/sync` return the full window from the
      beginning, all of it in `added`.
    * Those rows go through `pg_insert(...).on_conflict_do_nothing()` keyed on
      the unique `plaid_tx_id`, so a row already stored is **skipped entirely**
      — not updated, not duplicated. Categories, and every other field on an
      existing row, are therefore untouched by a rebuild.
    * `added_count` is the insert's rowcount, so a repeat rebuild honestly
      reports zero new transactions rather than re-counting the history.
    * `removed` is empty from a null cursor, so nothing is deleted.
    * Each Item is its own background task with its own session; one failing
      bank cannot block another, and each records its own sync health.

    It is safe to run any number of times. It is also slow — this asks every
    bank for its whole available window — which is why the client polls
    `/plaid/sync-status` for completion instead of trusting this response.
    """
    items = db.query(PlaidItem).filter(PlaidItem.user_id == current_user.id).all()
    if not items:
        raise HTTPException(status_code=404, detail="No connected banks.")
    for item in items:
        item.cursor = None
    db.commit()
    for item in items:
        background.add_task(facade._do_sync_and_notify, item.id, current_user.id, SYNC_SOURCE_MANUAL)
    return {"message": f"Cursor reset for {len(items)} bank(s). Full replay running in background."}


@router.post("/reset")
def reset_plaid_data(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete every Plaid-imported transaction and bank connection for this user.

    Two phases, in this order, and the order is the whole design.

    **Remote first, for every Item, before anything local is deleted.** The
    previous version deleted the transactions first, then swallowed each
    `/item/remove` failure and dropped the local rows anyway — so a bank that
    Plaid still considered live became invisible to Fintrack with its history
    already destroyed. 6C-5 made single-bank Disconnect refuse to lie; Reset
    must not be the way back around that.

    A remote API cannot be rolled back, so partial failure is handled by not
    starting the destructive half: if any Item fails to remove, nothing local
    is touched and the response names the institution. Retrying is safe and
    complete — the Items already removed answer `ITEM_NOT_FOUND` on the second
    pass, which is terminal proof they are gone, so the retry resolves them and
    carries on to the ones that remain.

    Account balances are deliberately **not** reconciled here. `Account.balance`
    is an absolute figure — the institution's own number, written by
    `/accounts/get` — not a sum of the rows this deletes, and the imported
    window is not the account's whole life. There is no stored baseline to
    recompute it from, so any value derived here would be invented. See
    `test_account_balances_are_left_stale_CURRENT_BEHAVIOUR`, which stays
    pinned until an opening-balance column exists to make the arithmetic real.
    """
    items = db.query(PlaidItem).filter(PlaidItem.user_id == current_user.id).all()

    # ── Phase 1: resolve every Item at Plaid ──────────────────────────────────
    unresolved: list[str] = []
    for item in items:
        try:
            facade._plaid_post("/item/remove", {"access_token": facade._item_access_token(db, item)})
        except PlaidItemNotFound:
            # Already gone at Plaid — terminal, and the reason a retry after a
            # partial failure can finish rather than starting over.
            logger.info(
                "plaid_reset_item_already_removed %s",
                kv(item_id=item.id, user_id=current_user.id),
            )
        except Exception as exc:
            unresolved.append(item.institution_name or "a bank")
            logger.warning(
                "plaid_remote_reset_failed %s",
                kv(item_id=item.id, user_id=current_user.id, error_type=type(exc).__name__),
            )

    if unresolved:
        # Nothing has been deleted at this point, and the claim in this message
        # is only true because the destructive phase is below it, not above.
        names = ", ".join(sorted(set(unresolved)))
        raise HTTPException(
            status_code=502,
            detail=(
                f"Reset could not continue because {names} could not be disconnected. "
                "Nothing in your imported transaction history was deleted — try again."
            ),
        )

    # ── Phase 2: the destructive half, once and atomically ───────────────────
    try:
        deleted_count = db.query(Transaction).filter(
            Transaction.user_id == current_user.id,
            Transaction.plaid_tx_id.isnot(None),
        ).delete(synchronize_session=False)
        for item in items:
            db.delete(item)
        db.commit()
    except Exception as exc:
        # One transaction, so the history and the connections fall together
        # rather than leaving the rows deleted and the Items still listed.
        db.rollback()
        logger.error(
            "plaid_reset_local_delete_failed %s",
            kv(user_id=current_user.id, error_type=type(exc).__name__),
        )
        raise HTTPException(
            status_code=500,
            detail=(
                "Your banks were disconnected at Plaid, but Fintrack could not finish "
                "clearing their data. Try again to complete it."
            ),
        )

    return {"message": f"Cleared {deleted_count} Plaid transactions and {len(items)} bank connection(s). Reconnect your bank to start fresh."}
