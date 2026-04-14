from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from models.database import Base, engine, SessionLocal, Category
from routers import accounts, categories, transactions, assets, auth

Base.metadata.create_all(bind=engine)


def seed_default_categories():
    db = SessionLocal()
    try:
        if db.query(Category).count() == 0:
            defaults = [
                Category(name="Salary", type="income", color="#BBD151"),
                Category(name="Freelance", type="income", color="#F9B672"),
                Category(name="Investment Returns", type="income", color="#1F422C"),
                Category(name="Other Income", type="income", color="#84848A"),
                Category(name="Housing & Rent", type="expense", color="#B12B24"),
                Category(name="Food & Dining", type="expense", color="#F9B672"),
                Category(name="Transportation", type="expense", color="#84848A"),
                Category(name="Entertainment", type="expense", color="#6366f1"),
                Category(name="Healthcare", type="expense", color="#B12B24"),
                Category(name="Shopping", type="expense", color="#050725"),
                Category(name="Utilities", type="expense", color="#1F422C"),
                Category(name="Travel", type="expense", color="#BBD151"),
                Category(name="Other", type="expense", color="#84848A"),
            ]
            db.add_all(defaults)
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


seed_default_categories()

app = FastAPI(
    title="Financial Tracker API",
    description="API for tracking finances - accounts, transactions, assets",
    version="1.0.0"
)

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

app.include_router(accounts.router)
app.include_router(categories.router)
app.include_router(transactions.router)
app.include_router(assets.router)
app.include_router(auth.router)


@app.get("/")
def root():
    return {"message": "Financial Tracker API", "docs": "/docs", "version": "1.0.0"}
