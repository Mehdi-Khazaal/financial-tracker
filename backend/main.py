import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text
from starlette.middleware.base import BaseHTTPMiddleware

from models.database import Base, engine
from routers import accounts, assets, auth, categories, transactions
from routers import admin, assistant, cron, history, loans, plaid_router, push, recurring_transactions, savings_goals, stocks, transfers
from utils.limiter import limiter
from utils.logging import get_logger, kv
from utils.security import BrowserOriginMiddleware
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


_prepare_database()


app = FastAPI(title="Fintrack API", version="2.0.0")

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_extra_origin = os.getenv("EXTRA_ALLOWED_ORIGIN", "")
_allowed_origins = [
    origin
    for origin in [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://financial-tracker-gamma-sable.vercel.app",
        _extra_origin,
    ]
    if origin
]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization", "Cookie"],
)
app.add_middleware(BrowserOriginMiddleware, allowed_origins=_allowed_origins)

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
app.include_router(push.router)
app.include_router(admin.router)
app.include_router(cron.router)
app.include_router(plaid_router.router)
app.include_router(assistant.router)


class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if os.getenv("ENVIRONMENT") == "production":
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        return response


app.add_middleware(NoCacheMiddleware)
app.add_middleware(IdempotencyMiddleware)


@app.get("/")
def root():
    return {"message": "Fintrack API v2", "docs": "/docs"}
