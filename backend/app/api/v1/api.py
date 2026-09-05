from fastapi import APIRouter
from app.api.v1.endpoints import auth, videos, phrases, reviews, progress, ai

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api_router.include_router(videos.router, prefix="/videos", tags=["Videos"])
api_router.include_router(phrases.router, prefix="/phrases", tags=["Phrases"])
api_router.include_router(reviews.router, prefix="/reviews", tags=["Reviews & SRS"])
api_router.include_router(progress.router, prefix="/progress", tags=["Progress & Analytics"])
api_router.include_router(ai.router, prefix="/ai", tags=["AI & Translation"])
