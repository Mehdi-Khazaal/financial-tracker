import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware

from routers import accounts, assets, auth, categories, transactions
from routers import admin, cron, history, loans, plaid_router, push, recurring_transactions, savings_goals, stocks, transfers
from utils.limiter import limiter


app = FastAPI(title="Fintrack API", version="2.0.0")

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_extra_origin = os.getenv("EXTRA_ALLOWED_ORIGIN", "")
_allowed_origins = [
    origin
    for origin in [
        "http://localhost:3000",
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
