import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from models.database import Base, engine
from routers import accounts, categories, transactions, assets, auth
from routers import transfers, savings_goals, stocks

# ── DB init ───────────────────────────────────────────────────────────────────
# Set RESET_DB=true in Render env vars to wipe and recreate all tables on next deploy.
# Remove it after the first clean deploy.
if os.getenv("RESET_DB", "false").lower() == "true":
    Base.metadata.drop_all(bind=engine)
    print("⚠️  Database wiped.")
Base.metadata.create_all(bind=engine)

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Fintrack API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://financial-tracker-gamma-sable.vercel.app",
        "https://financial-tracker-esjhlztp3-mehdi-khazaals-projects.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(categories.router)
app.include_router(transactions.router)
app.include_router(transfers.router)
app.include_router(assets.router)
app.include_router(savings_goals.router)
app.include_router(stocks.router)


@app.get("/")
def root():
    return {"message": "Fintrack API v2", "docs": "/docs"}
