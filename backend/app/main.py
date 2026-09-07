from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.api import api_router
from app.core.config import settings
from app.core.database import Base, engine
import app.models


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Try to auto-create tables on startup (ignored if DB not yet reachable or handled by Alembic)
    try:
        Base.metadata.create_all(bind=engine)
        with engine.connect() as conn:
            from sqlalchemy import text
            conn.execute(text("ALTER TABLE saved_phrases ALTER COLUMN video_id DROP NOT NULL;"))
            conn.commit()
    except Exception as e:
        print(f"Notice: Database connection deferred or handled by Alembic: {e}")
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    redoc_url=f"{settings.API_V1_STR}/redoc",
    lifespan=lifespan,
)

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_STR)


@app.get("/")
def root():
    return {
        "app": settings.PROJECT_NAME,
        "status": "online",
        "docs": f"{settings.API_V1_STR}/docs"
    }


@app.get("/health")
def health_check():
    return {"status": "healthy"}
