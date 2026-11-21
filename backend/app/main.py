from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import traceback

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
    # create_all never alters existing tables: add columns introduced after first deploy.
    try:
        from sqlalchemy import inspect, text
        insp = inspect(engine)
        if "duels" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("duels")}
            wanted = {
                "game_type": "VARCHAR(20) NOT NULL DEFAULT 'VOCAB'",
                "mode": "VARCHAR(10) NOT NULL DEFAULT 'ASYNC'",
                "live_phase": "VARCHAR(12)",
                "live_index": "INTEGER NOT NULL DEFAULT 0",
                "phase_started_at": "TIMESTAMP",
            }
            for name, ddl in wanted.items():
                if name not in cols:
                    with engine.begin() as conn:
                        conn.execute(text(f"ALTER TABLE duels ADD COLUMN {name} {ddl}"))
    except Exception as e:
        print(f"Notice: game_type column check skipped: {e}")
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    redoc_url=f"{settings.API_V1_STR}/redoc",
    lifespan=lifespan,
)

# Global exception handler to guarantee CORS headers on 500 errors
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    error_trace = traceback.format_exc()
    print(f"[UNHANDLED EXCEPTION] {request.method} {request.url.path}: {exc}\n{error_trace}")
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal Server Error: {str(exc)}"},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*",
        }
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
    db_status = "ok"
    db_error = None
    try:
        with engine.connect() as conn:
            from sqlalchemy import text
            conn.execute(text("SELECT 1;"))
    except Exception as e:
        db_status = "error"
        db_error = str(e)

    return {
        "status": "healthy" if db_status == "ok" else "degraded",
        "database": db_status,
        "db_error": db_error
    }
