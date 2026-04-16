import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from models.database import Base, engine
from routers import accounts, categories, transactions, assets, auth
from routers import transfers, savings_goals, stocks, recurring_transactions, history, loans
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
            """CREATE TABLE IF NOT EXISTS savings_goal_allocations (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                goal_id INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                amount NUMERIC(15,2) NOT NULL
            )""",
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://financial-tracker-gamma-sable.vercel.app",
        "https://financial-tracker-esjhlztp3-mehdi-khazaals-projects.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
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


@app.get("/")
def root():
    return {"message": "Fintrack API v2", "docs": "/docs"}
