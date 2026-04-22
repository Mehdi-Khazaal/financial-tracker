import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from models.database import Base, engine
from routers import accounts, categories, transactions, assets, auth
from routers import transfers, savings_goals, stocks, recurring_transactions, history, loans, push, admin, cron
from routers import plaid_router  # must be imported before create_all so PlaidItem registers with Base
from utils.limiter import limiter

# ── DB init ───────────────────────────────────────────────────────────────────
if os.getenv("RESET_DB", "false").lower() == "true":
    Base.metadata.drop_all(bind=engine)
    print("⚠️  Database wiped.")
Base.metadata.create_all(bind=engine)

# ── Schema migrations (safe to re-run) ───────────────────────────────────────
def _run_migrations():
    with engine.connect() as conn:
        migrations = [
            "ALTER TABLE recurring_transactions ADD COLUMN IF NOT EXISTS is_variable BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE loans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE",
            """CREATE TABLE IF NOT EXISTS push_subscriptions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                endpoint TEXT UNIQUE NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS savings_goal_allocations (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                goal_id INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                amount NUMERIC(15,2) NOT NULL
            )""",
            """CREATE TABLE IF NOT EXISTS plaid_items (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                access_token TEXT NOT NULL,
                item_id VARCHAR(200) NOT NULL UNIQUE,
                institution_name VARCHAR(200),
                cursor TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS plaid_tx_id VARCHAR(200)",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_plaid_tx_id ON transactions (plaid_tx_id) WHERE plaid_tx_id IS NOT NULL",
        ]
        for sql in migrations:
            try:
                conn.execute(text(sql))
            except Exception as e:
                print(f"Migration skipped ({e})")
        conn.commit()


from sqlalchemy import text
_run_migrations()

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Fintrack API", version="2.0.0")

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_extra_origin = os.getenv("EXTRA_ALLOWED_ORIGIN", "")
_allowed_origins = [o for o in [
    "http://localhost:3000",
    "https://financial-tracker-gamma-sable.vercel.app",
    _extra_origin,
] if o]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization", "Cookie"],
)

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


class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

app.add_middleware(NoCacheMiddleware)


@app.get("/")
def root():
    return {"message": "Fintrack API v2", "docs": "/docs"}


