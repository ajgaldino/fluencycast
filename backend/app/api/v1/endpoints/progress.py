from datetime import datetime, timezone
from typing import Any
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.video import Video
from app.models.phrase import SavedPhrase
from app.models.review import PhraseReview, StudySession

router = APIRouter()


class ProgressStatsResponse(BaseModel):
    total_videos: int
    total_phrases: int
    mastered_phrases: int
    learning_phrases: int
    total_reviews: int
    current_streak: int
    level: str


@router.get("/", response_model=ProgressStatsResponse)
def get_user_progress(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Get user learning progress statistics.
    """
    total_videos = db.query(Video).filter(Video.user_id == current_user.id).count()
    total_phrases = db.query(SavedPhrase).filter(SavedPhrase.user_id == current_user.id).count()
    mastered_phrases = (
        db.query(SavedPhrase)
        .filter(SavedPhrase.user_id == current_user.id, SavedPhrase.status == "MASTERED")
        .count()
    )
    learning_phrases = total_phrases - mastered_phrases
    total_reviews = (
        db.query(PhraseReview)
        .join(SavedPhrase)
        .filter(SavedPhrase.user_id == current_user.id)
        .count()
    )

    streak = current_user.profile.current_streak if current_user.profile else 1
    level = current_user.profile.english_level if current_user.profile else "B1"

    return ProgressStatsResponse(
        total_videos=total_videos,
        total_phrases=total_phrases,
        mastered_phrases=mastered_phrases,
        learning_phrases=learning_phrases,
        total_reviews=total_reviews,
        current_streak=streak,
        level=level
    )
