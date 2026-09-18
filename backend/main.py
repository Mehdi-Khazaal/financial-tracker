import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from models.database import Base, engine
from routers import accounts, assets, auth, categories, transactions
from routers import account, admin, assistant, budgets, cron, health, history, loans, plaid_router, preferences, push, recurring_transactions, savings_goals, stocks, transfers
from utils.limiter import limiter
from utils.logging import get_logger, kv
from utils.migrations import OUTCOME_INITIALIZED, OUTCOME_UPGRADED, run_startup_migrations
from utils.monitoring import init_sentry
from utils.request_context import RequestIdMiddleware
from utils.security import (
    BrowserOriginMiddleware,
    SecurityHeadersMiddleware,
    allowed_browser_origins,
    api_docs_enabled,
)
from utils.idempotency import IdempotencyMiddleware
# Registers background job handlers with the dispatcher at import time.
from services import job_handlers  # noqa: F401


logger = get_logger(__name__)


def _prepare_database() -> None:
    """Keep deployments usable without a manual migration step.

    This is intentionally non-destructive: it creates missing tables and adds
    missing compatibility columns, but never drops or rewrites user data.
    Alembic remains available for explicit migration workflows.
    """
    if os.getenv("AUTO_PREPARE_DB", "true").lower() != "true":
        logger.info("automatic database preparation disabled")
        return

    Base.metadata.create_all(bind=engine)

    migrations = [
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(15, 2)",
        "ALTER TABLE assets ADD COLUMN IF NOT EXISTS asset_class VARCHAR(20) NOT NULL DEFAULT 'physical'",
        """UPDATE assets
           SET asset_class = 'investment'
           WHERE asset_class = 'physical'
             AND LOWER(type) IN ('stock', 'crypto', 'gold', 'silver', 'etf', 'bond')""",
        "ALTER TABLE categories ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE",
        "ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE recurring_transactions ADD COLUMN IF NOT EXISTS is_variable BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE loans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS plaid_tx_id VARCHAR(200)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_plaid_tx_id ON transactions (plaid_tx_id) WHERE plaid_tx_id IS NOT NULL",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS plaid_account_id VARCHAR(200)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_plaid_account_id ON accounts (plaid_account_id) WHERE plaid_account_id IS NOT NULL",
        # `updated_at` on hot tables lets the ETag helper detect edits (not just
        # inserts/deletes) so /accounts, /transactions, /categories, and
        # /savings-goals can safely short-circuit to 304 on repeat reads.
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
        "ALTER TABLE categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
        "ALTER TABLE savings_goals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
        # The assistant resolves "today" in the user's own zone; the server is UTC.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone VARCHAR(64)",
        # ── Transaction intelligence (Phase 5A) ──────────────────────────────
        # Merchant identity and the Plaid enrichment sync used to discard.
        # `create_all` above adds missing *tables* but never adds columns to a
        # table that already exists, so these have to be listed explicitly —
        # without them every query touching `transactions` selects columns the
        # database does not have and returns a 500. Mirrors Alembic revision
        # 20260805_000009; both must be updated together.
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS plaid_merchant_entity_id VARCHAR(64)",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS plaid_merchant_name VARCHAR(200)",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS original_description TEXT",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS merchant_key VARCHAR(120)",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS personal_finance_category_primary VARCHAR(60)",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS personal_finance_category_detailed VARCHAR(100)",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category_source VARCHAR(20)",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_channel VARCHAR(20)",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_code VARCHAR(40)",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS authorized_date DATE",
        "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS iso_currency_code VARCHAR(8)",
        # Serves `WHERE user_id = ? ORDER BY transaction_date DESC`, the app's
        # most frequent query. Mirrors Alembic revision 20260824_000012.
        "CREATE INDEX IF NOT EXISTS ix_transactions_user_date ON transactions (user_id, transaction_date)",
        "CREATE INDEX IF NOT EXISTS ix_transactions_user_merchant_key ON transactions (user_id, merchant_key)",
        "CREATE INDEX IF NOT EXISTS ix_transactions_user_merchant_entity ON transactions (user_id, plaid_merchant_entity_id)",
        # ── Plaid sync health ────────────────────────────────────────────────
        # Diagnostic columns for why a connection is or is not syncing. Mirrors
        # Alembic revision 20260811_000010; both must be updated together.
        "ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS last_webhook_at TIMESTAMP",
        "ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS last_webhook_code VARCHAR(60)",
        "ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP",
        "ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS last_sync_source VARCHAR(20)",
        "ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS last_sync_ok BOOLEAN",
        "ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS last_sync_error VARCHAR(300)",
        "ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS last_added_count INTEGER",
        "ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS last_modified_count INTEGER",
        "ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS last_removed_count INTEGER",
        # ── Recurring bills remodel ──────────────────────────────────────────
        # Groups, bank-charge matching and alert bookkeeping. Mirrors Alembic
        # revision 20260916_000013; both must be updated together.
        "ALTER TABLE recurring_transactions ADD COLUMN IF NOT EXISTS group_key VARCHAR(30)",
        "ALTER TABLE recurring_transactions ADD COLUMN IF NOT EXISTS source VARCHAR(20)",
        "ALTER TABLE recurring_transactions ADD COLUMN IF NOT EXISTS plaid_merchant_entity_id VARCHAR(64)",
        "ALTER TABLE recurring_transactions ADD COLUMN IF NOT EXISTS merchant_key VARCHAR(120)",
        "ALTER TABLE recurring_transactions ADD COLUMN IF NOT EXISTS last_paid_date DATE",
        "ALTER TABLE recurring_transactions ADD COLUMN IF NOT EXISTS last_paid_amount NUMERIC(15, 2)",
        "ALTER TABLE recurring_transactions ADD COLUMN IF NOT EXISTS last_transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL",
        "ALTER TABLE recurring_transactions ADD COLUMN IF NOT EXISTS previous_amount NUMERIC(15, 2)",
        "ALTER TABLE recurring_transactions ADD COLUMN IF NOT EXISTS amount_changed_on DATE",
        "ALTER TABLE recurring_transactions ADD COLUMN IF NOT EXISTS reminder_sent_for DATE",
        "ALTER TABLE recurring_transactions ADD COLUMN IF NOT EXISTS missed_alert_sent_for DATE",
        "ALTER TABLE recurring_transactions ADD COLUMN IF NOT EXISTS price_alert_sent_on DATE",
        "ALTER TABLE recurring_transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
        # ── Savings-goal milestone bookkeeping ────────────────────────────────
        # Mirrors Alembic revision 20260917_000015; both must be updated together.
        "ALTER TABLE savings_goals ADD COLUMN IF NOT EXISTS milestone_notified INTEGER NOT NULL DEFAULT 0",
    ]
    with engine.begin() as conn:
        for sql in migrations:
            try:
                # PostgreSQL marks the whole transaction as failed after one
                # bad statement. A savepoint keeps compatibility repairs
                # independent so later columns can still be added safely.
                with conn.begin_nested():
                    conn.execute(text(sql))
            except Exception as exc:
                logger.info("database compatibility migration skipped %s", kv(error=str(exc), sql=sql))


# Schema management, in order of preference:
#   1. Alembic (`utils.migrations`): a stamped database is upgraded to head.
#   2. The legacy boot-time repairs above, for a database that has never been
#      stamped — production until `alembic stamp` is run once — and as the
#      fallback if a migration fails, so a bad revision degrades to "yesterday's
#      behaviour" rather than "no service".
_migration_outcome = run_startup_migrations(engine)
if _migration_outcome in {OUTCOME_INITIALIZED, OUTCOME_UPGRADED}:
    # Alembic owns the schema. `create_all` is kept as a no-op safety net for
    # any ORM table a revision might lag behind; it never alters a column.
    Base.metadata.create_all(bind=engine)
else:
    _prepare_database()

init_sentry()


_docs_enabled = api_docs_enabled()
app = FastAPI(
    title="Fintrack API",
    version="2.0.0",
    # The schema is a map for anyone probing the API. Off in production
    # unless `EXPOSE_API_DOCS=true` — see `utils.security.api_docs_enabled`.
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Trusted browser origins: the defaults below plus `ALLOWED_ORIGINS` (CSV) and
# the legacy `EXTRA_ALLOWED_ORIGIN`, so a custom domain or a preview deploy is
# configuration rather than a code change.
_allowed_origins = allowed_browser_origins(
    [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://financial-tracker-gamma-sable.vercel.app",
    ]
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization", "Cookie"],
)
app.add_middleware(BrowserOriginMiddleware, allowed_origins=_allowed_origins)

app.include_router(health.router)
app.include_router(account.router)
app.include_router(budgets.router)
app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(categories.router)
app.include_router(transactions.router)
app.include_router(transfers.router)
app.include_router(assets.router)
app.include_router(savings_goals.router)
app.include_router(stocks.router)
app.include_router(recurring_transactions.router)
app.include_router(history.router)
app.include_router(loans.router)
app.include_router(preferences.router)
app.include_router(push.router)
app.include_router(admin.router)
app.include_router(cron.router)
app.include_router(plaid_router.router)
app.include_router(assistant.router)


# No-store caching plus the security headers (CSP, COOP, CORP, HSTS in prod).
# See `utils.security.security_headers` for the exact policy.
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(IdempotencyMiddleware)
# Outermost, so the id covers every other middleware's work and every log line.
app.add_middleware(RequestIdMiddleware)


@app.get("/")
def root():
    payload = {"message": "Fintrack API v2"}
    if _docs_enabled:
        payload["docs"] = "/docs"
    return payload
