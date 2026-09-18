"""Transaction ingestion: /accounts/get, /transactions/sync paging, and the
background task that runs a sync and reports it.

Every Plaid call goes through `facade._plaid_post` so a test that patches
`routers.plaid_router._plaid_post` sees every request this module makes.
"""

from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from models.auth import User
from models.database import Account, SessionLocal, Transaction
from routers import plaid_router as facade
from routers.plaid_router import (
    MAX_PAGINATION_RESTARTS,
    SYNC_SOURCE_OTHER,
    PlaidMutationDuringPagination,
    _safe_error,
    record_sync_health,
)
from routers.plaid_router.models import PlaidItem
from services.transaction_enrichment import (
    enrich_transaction_input,
    resolve_transaction_merchant,
    suggest_transaction_category,
)
from utils.logging import get_logger, kv
from utils.push_sender import send_push_to_user

logger = get_logger(__name__)


def _plaid_amount(tx: dict) -> Decimal:
    return Decimal(str(tx["amount"])) * Decimal("-1")


def _plaid_description(tx: dict, fallback: Optional[str] = None) -> str:
    return tx.get("merchant_name") or tx.get("name") or fallback or "Transaction"


def _optional_date(value) -> Optional[date]:
    """Parse a Plaid ISO date, tolerating null and malformed values."""
    if not value or not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _plaid_metadata(tx: dict) -> dict:
    """Extract the enrichment fields worth persisting from a Plaid transaction.

    Only what carries merchant identity or recurrence signal. Location, logo,
    website and the counterparty array are deliberately not read: none of them
    is needed to identify a merchant once `merchant_entity_id` is stored, and
    they are the bulkiest and most personal parts of the payload.
    """
    pfc = tx.get("personal_finance_category")
    if not isinstance(pfc, dict):
        pfc = {}
    return {
        "plaid_merchant_entity_id": tx.get("merchant_entity_id") or None,
        "plaid_merchant_name": tx.get("merchant_name") or None,
        # Plaid's `name` is the raw bank string. `description` collapses it
        # with `merchant_name`, so keeping it separately is the only way to
        # re-derive a merchant key later without re-fetching from Plaid.
        "original_description": tx.get("name") or None,
        "personal_finance_category_primary": pfc.get("primary") or None,
        "personal_finance_category_detailed": pfc.get("detailed") or None,
        "payment_channel": tx.get("payment_channel") or None,
        "transaction_code": tx.get("transaction_code") or None,
        "authorized_date": _optional_date(tx.get("authorized_date")),
        "iso_currency_code": tx.get("iso_currency_code")
        or tx.get("unofficial_currency_code")
        or None,
    }


def _apply_pending_replacement(db: Session, tx: dict, user_id: int, local_acct: Account) -> bool:
    """Update a categorized pending transaction when Plaid replaces it with the posted one."""
    pending_tx_id = tx.get("pending_transaction_id")
    if not pending_tx_id:
        return False

    existing = db.query(Transaction).filter(
        Transaction.user_id == user_id,
        Transaction.plaid_tx_id == pending_tx_id,
    ).first()
    if not existing:
        return False

    posted = db.query(Transaction).filter(
        Transaction.user_id == user_id,
        Transaction.plaid_tx_id == tx["transaction_id"],
    ).first()
    metadata = _plaid_metadata(tx)

    if posted:
        # Carry the pending row's category across so a categorization the user
        # made while the charge was pending is not lost when it settles.
        if posted.category_id is None:
            posted.category_id = existing.category_id
            posted.category_source = existing.category_source
        posted.account_id = local_acct.id
        posted.amount = _plaid_amount(tx)
        posted.description = _plaid_description(tx, posted.description)
        posted.transaction_date = date.fromisoformat(tx["date"])
        _apply_metadata(posted, metadata)
        db.delete(existing)
        return True

    existing.account_id = local_acct.id
    existing.amount = _plaid_amount(tx)
    existing.description = _plaid_description(tx, existing.description)
    existing.transaction_date = date.fromisoformat(tx["date"])
    existing.plaid_tx_id = tx["transaction_id"]
    _apply_metadata(existing, metadata)
    return True


def _posted_row(db: Session, tx: dict, user_id: int, local_acct: Account) -> dict:
    """Build the enriched insert row for a *posted* Plaid transaction.

    Shared by both ingestion paths — `added`, and the `modified` fallback for a
    charge that settles under an id we never stored. Those two paths having
    their own copies is exactly how card charges went missing, so there is one
    definition and both call it.

    Stages only: the caller still owns the write, so the bulk insert's
    ON CONFLICT DO NOTHING and the per-page cursor commit are untouched.
    """
    return enrich_transaction_input(db, user_id, {
        "user_id":          user_id,
        "account_id":       local_acct.id,
        "category_id":      None,
        "amount":           _plaid_amount(tx),  # Plaid positive = debit; we store debits as negative
        "description":      _plaid_description(tx),
        "plaid_tx_id":      tx["transaction_id"],
        "transaction_date": date.fromisoformat(tx["date"]),
        **_plaid_metadata(tx),
    })


def _apply_metadata(row: Transaction, metadata: dict) -> None:
    """Write Plaid metadata onto a row and re-derive its merchant key.

    Leaves `category_id` alone — replacement and modification must never
    disturb a category the user is looking at.
    """
    for field, value in metadata.items():
        setattr(row, field, value)
    identity = resolve_transaction_merchant(
        row.description,
        plaid_merchant_entity_id=row.plaid_merchant_entity_id,
    )
    row.merchant_key = identity.key or None


def _local_balance(plaid_balances: dict, is_credit: bool) -> Decimal:
    """Plaid's balance, in Fintrack's sign convention.

    Plaid and Fintrack describe a credit card from opposite sides. Plaid states
    it as a liability — *"For `credit`-type accounts, a positive balance
    indicates the amount owed; a negative amount indicates the lender owing the
    account holder"* — while Fintrack stores every account from the holder's
    side, where money you owe is negative and money owed to you is positive.
    One negation converts between them.

    This used to be `-abs(current)`, which is the same thing for the ordinary
    case and silently wrong for the interesting one: overpay a card and Plaid
    reports a *negative* current balance, which `-abs` mapped straight back to
    negative — indistinguishable from owing that amount. A card the issuer owed
    money on displayed as debt, and the overpayment was invisible in net worth.

    Depository accounts are already stated from the holder's side and pass
    through untouched.
    """
    current = Decimal(str(plaid_balances.get("current") or 0))
    return -current if is_credit else current


def _match_local_account(
    db: Session, user_id: int, plaid_acct_id: str, acct_name: str
) -> Optional[Account]:
    """The local account a Plaid account belongs to, if one already exists.

    Two rules, in order:

    1. **Plaid's account id**, which is authoritative and unambiguous.
    2. **The name — but only for an account no bank has claimed.** Matching on
       a name is how a "Savings" someone typed in by hand gets adopted the
       first time their bank is connected, instead of appearing twice.

    The `plaid_account_id IS NULL` half of that second rule is the load-bearing
    part. Without it, connecting a bank whose account happens to share a name
    with one *another* bank already owns would take that account over:
    overwrite its balance and repoint its `plaid_account_id`, which is unique,
    so it either steals the link or fails the write outright. Generic names —
    "Savings", "Checking", "Credit Card" — make that collision ordinary rather
    than exotic.

    Both ingestion paths call this, because they used to disagree: the sync
    checked that the account was unclaimed and the initial connect did not.
    """
    by_plaid_id = (
        db.query(Account)
        .filter(Account.user_id == user_id, Account.plaid_account_id == plaid_acct_id)
        .first()
    )
    if by_plaid_id:
        return by_plaid_id

    return (
        db.query(Account)
        .filter(
            Account.user_id == user_id,
            Account.name == acct_name,
            Account.plaid_account_id.is_(None),
        )
        .first()
    )


def _uniform_rows(rows: list[dict]) -> list[dict]:
    """Give every row the same keys, filling the gaps with None.

    A multi-row INSERT is compiled from the *first* row's key set, and a column
    missing from a later row needs a Python-side default that these nullable
    columns do not have. One row carrying an extra key therefore raises
    CompileError and **no** row on the page is written — the statement never
    reaches the database. Enrichment is the source of that asymmetry, since it
    fills the category fields only when it has an answer, so the rows are
    squared up here rather than trusting every producer to stay in step.

    Order is first-seen, not set order, so the generated SQL is stable.
    """
    keys = {key: None for row in rows for key in row}
    return [{key: row.get(key) for key in keys} for row in rows]


# ─── Sync logic ───────────────────────────────────────────────────────────────
def _sync_item(db: Session, item: PlaidItem, user_id: int) -> int:
    """Sync one Plaid item. Returns number of new transactions added."""
    added_count = 0
    cursor = item.cursor or ""

    # Fetch accounts — update local balances and build plaid_account_id → Account map
    access_token = facade._item_access_token(db, item)
    accounts_data = facade._plaid_post("/accounts/get", {"access_token": access_token})
    local_acct_cache: dict[str, Optional[Account]] = {}

    for acct in accounts_data.get("accounts", []):
        plaid_acct_id = acct["account_id"]
        acct_name = acct.get("official_name") or acct.get("name") or "Unknown"
        subtype = (acct.get("subtype") or "other").lower()
        balance = _local_balance(acct["balances"], subtype in ("credit card", "credit"))

        local_acct = _match_local_account(db, user_id, plaid_acct_id, acct_name)
        if local_acct is not None:
            local_acct.plaid_account_id = plaid_acct_id

        if local_acct:
            local_acct.balance = Decimal(str(balance))
            local_acct_cache[plaid_acct_id] = local_acct
        else:
            local_acct_cache[plaid_acct_id] = None

    db.flush()

    # Page through /transactions/sync, committing after each page.
    #
    # The cursor the cycle *starts* from is remembered, because a
    # mutation-during-pagination error invalidates every intermediate cursor
    # this cycle produced. On that error the loop restarts from here rather
    # than resuming from wherever it got to. Re-fetching already-stored
    # transactions is harmless: the insert is ON CONFLICT DO NOTHING keyed on
    # `plaid_tx_id`, so a restart cannot duplicate anything.
    cycle_start_cursor = cursor
    restarts = 0
    while True:
        body: dict = {"access_token": access_token, "count": 500}
        if cursor:
            body["cursor"] = cursor
        try:
            data = facade._plaid_post("/transactions/sync", body)
        except PlaidMutationDuringPagination:
            restarts += 1
            if restarts > MAX_PAGINATION_RESTARTS:
                logger.warning(
                    "plaid_sync_mutation_restart_limit %s",
                    kv(item_id=item.id, user_id=user_id, restarts=restarts - 1),
                )
                raise
            # Discard anything staged and rewind the stored cursor to where
            # the cycle began, so no intermediate cursor survives.
            #
            # `added_count` is deliberately *not* reset. The error surfaces on
            # the request at the top of an iteration, by which point every
            # counted row was already committed by the previous iteration —
            # those rows are genuinely in the database. On the retry they are
            # re-offered and absorbed by ON CONFLICT DO NOTHING, contributing
            # a rowcount of zero, so they are counted exactly once.
            db.rollback()
            cursor = cycle_start_cursor
            item.cursor = cycle_start_cursor or None
            db.commit()
            logger.info(
                "plaid_sync_mutation_restart %s",
                kv(item_id=item.id, user_id=user_id, attempt=restarts),
            )
            continue

        # Added — bulk insert; ON CONFLICT DO NOTHING is atomic, no race condition possible.
        # Skip pending charges entirely — they get replaced by a posted transaction with a
        # different transaction_id, forcing the user to re-categorize each time. We only
        # import posted (settled) transactions so each purchase is categorized once.
        rows_to_add = []
        for tx in data.get("added", []):
            if tx.get("pending"):
                continue
            local_acct = local_acct_cache.get(tx["account_id"])
            if not local_acct:
                continue
            if _apply_pending_replacement(db, tx, user_id, local_acct):
                continue
            # Same enrichment step manual entry uses, so a bank-imported row
            # gets a merchant key and a category suggestion instead of landing
            # permanently uncategorized.
            rows_to_add.append(_posted_row(db, tx, user_id, local_acct))
        if rows_to_add:
            result = db.execute(
                pg_insert(Transaction).values(_uniform_rows(rows_to_add)).on_conflict_do_nothing()
            )
            added_count += result.rowcount

        # Modified — update amount/description/date if Plaid revised a transaction.
        #
        # A modified transaction may have *no row to modify*, and that case is
        # not an anomaly: card issuers settle a charge under the **same**
        # transaction_id, flipping `pending` false and delivering the settle
        # here rather than in `added`. The pending form was skipped on the way
        # in (see above), so there is nothing to update — and without the
        # fallback insert below, such a charge has no path into the ledger at
        # all. The cursor still advances at the end of the page, so the loss is
        # permanent rather than retried. This is why card accounts appeared to
        # stop syncing while checking accounts kept working: checking activity
        # changes id on settle and so arrives via `added` + `pending_transaction_id`.
        recovered_rows = []
        for tx in data.get("modified", []):
            existing = db.query(Transaction).filter(
                Transaction.user_id == user_id,
                Transaction.plaid_tx_id == tx["transaction_id"],
            ).first()
            if not existing:
                # Still unsettled — Plaid will deliver it again when it posts.
                if tx.get("pending"):
                    continue
                local_acct = local_acct_cache.get(tx["account_id"])
                if not local_acct:
                    continue
                # A legacy pending row (stored before pending charges were
                # skipped) is replaced rather than duplicated.
                if _apply_pending_replacement(db, tx, user_id, local_acct):
                    continue
                recovered_rows.append(_posted_row(db, tx, user_id, local_acct))
                continue

            revised_amount = _plaid_amount(tx)
            if Decimal(str(existing.amount)) != Decimal(str(revised_amount)):
                # The bank changed the charge, so a split made for the old
                # amount no longer adds up; the main category stays.
                from services import splits as split_service
                split_service.clear_by_id(db, existing.id)
            existing.amount           = revised_amount
            existing.description      = _plaid_description(tx, existing.description)
            existing.transaction_date = date.fromisoformat(tx["date"])
            for field, value in _plaid_metadata(tx).items():
                setattr(existing, field, value)
            identity = resolve_transaction_merchant(
                existing.description,
                plaid_merchant_entity_id=existing.plaid_merchant_entity_id,
            )
            existing.merchant_key = identity.key or None
            # Only fill a category that is still empty. A category the
            # user set — or one we inferred and they left in place — is
            # never overwritten by a later sync.
            if existing.category_id is None:
                category_id, source = suggest_transaction_category(
                    db,
                    user_id,
                    identity,
                    pfc_primary=existing.personal_finance_category_primary,
                )
                if category_id is not None:
                    existing.category_id = category_id
                    existing.category_source = source

        if recovered_rows:
            result = db.execute(
                pg_insert(Transaction).values(_uniform_rows(recovered_rows)).on_conflict_do_nothing()
            )
            added_count += result.rowcount

        # Removed — Plaid pulled the transaction back (e.g. a declined pending charge)
        for tx in data.get("removed", []):
            existing = db.query(Transaction).filter(
                Transaction.user_id == user_id,
                Transaction.plaid_tx_id == tx["transaction_id"],
            ).first()
            if existing:
                db.delete(existing)

        cursor = data.get("next_cursor", cursor)
        item.cursor = cursor
        db.commit()  # Commit per page — cursor is saved even if a later page fails

        if not data.get("has_more", False):
            break

    return added_count


def _reconcile_recurring(db: Session, user_id: int) -> None:
    """Mark tracked bills paid from the charges this sync just imported.

    Isolated so a problem here can never fail or roll back the sync itself —
    the transactions are already committed, and the nightly job reconciles
    again anyway.
    """
    try:
        from services import recurring_bills
        owner = db.query(User).filter(User.id == user_id).first()
        if owner and recurring_bills.reconcile_user(db, owner):
            db.commit()
    except Exception:
        db.rollback()
        logger.exception("plaid_recurring_reconcile_failed %s", kv(user_id=user_id))


def _notify_budgets(db: Session, user_id: int) -> None:
    """Over-budget pushes for anything this import tipped over. Same isolation
    as reconciliation: the sync has already succeeded and committed."""
    try:
        from services import budgets
        owner = db.query(User).filter(User.id == user_id).first()
        if owner:
            budgets.notify_over_budget(db, owner, send_push_to_user)
    except Exception:
        db.rollback()
        logger.exception("plaid_budget_notify_failed %s", kv(user_id=user_id))


def _notify_balances(db: Session, user_id: int) -> None:
    """Low-balance pushes after an import moved balances. Isolated like the rest."""
    try:
        from services import alerts
        owner = db.query(User).filter(User.id == user_id).first()
        if owner:
            alerts.check_low_balances(db, owner, send_push_to_user)
    except Exception:
        db.rollback()
        logger.exception("plaid_balance_notify_failed %s", kv(user_id=user_id))


def _do_sync_and_notify(plaid_item_db_id: int, user_id: int, source: str = SYNC_SOURCE_OTHER):
    """Background task — owns its own DB session so it outlives the request.

    `source` records what triggered this run so the health record can tell a
    webhook-driven sync from a button press. That distinction is the whole
    point of the observability: if every recent sync is `manual`, webhooks are
    not arriving, whatever Plaid believes it sent.
    """
    db = SessionLocal()
    try:
        item = db.query(PlaidItem).filter(PlaidItem.id == plaid_item_db_id).first()
        if not item:
            return
        try:
            count = _sync_item(db, item, user_id)
        except Exception as exc:
            record_sync_health(db, item, source=source, ok=False, error=_safe_error(exc))
            raise
        record_sync_health(db, item, source=source, ok=True, added=count)
        if count > 0:
            _reconcile_recurring(db, user_id)
            _notify_budgets(db, user_id)
            _notify_balances(db, user_id)
            send_push_to_user(
                db, user_id,
                "Bank sync complete",
                f"{count} new transaction{'s' if count != 1 else ''} imported from {item.institution_name or 'your bank'}.",
                url="/transactions",
                tag="plaid-sync",
            )
    except Exception:
        logger.exception("plaid_sync_failed %s", kv(item_id=plaid_item_db_id, user_id=user_id))
    finally:
        db.close()
