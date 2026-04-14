from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import accounts
from models.database import Base, engine
from routers import accounts, categories, transactions, assets, auth

# Create database tables if they don't exist
Base.metadata.create_all(bind=engine)

# Initialize FastAPI app
app = FastAPI(
    title="Financial Tracker API",
    description="API for tracking finances - accounts, transactions, assets",
    version="1.0.0"
)

# Configure CORS (allows frontend to call this API)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://financial-tracker-gamma-sable.vercel.app",  # Your Vercel URL
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(accounts.router)
app.include_router(categories.router)
app.include_router(transactions.router)
app.include_router(assets.router)
app.include_router(auth.router)

# Root endpoint
@app.get("/")
def root():
    return {
        "message": "Financial Tracker API",
        "docs": "/docs",
        "version": "1.0.0"
    }