from datetime import datetime, timezone, timedelta
from typing import Any, List
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Date

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.video import Video
from app.models.phrase import SavedPhrase
from app.models.review import PhraseReview, StudySession

router = APIRouter()


class DailyActivity(BaseModel):
    date: str
    reviews: int
    phrases_saved: int
    xp: int


class ProgressStatsResponse(BaseModel):
    total_videos: int
    total_phrases: int
    mastered_phrases: int
    learning_phrases: int
    total_reviews: int
    current_streak: int
    level: str
    total_xp: int
    xp_level: int
    xp_next_level: int
    xp_in_current_level: int
    weekly_activity: List[DailyActivity]


@router.get("/", response_model=ProgressStatsResponse)
def get_user_progress(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Get user learning progress statistics with XP and weekly activity.
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

    # Calculate XP: 15 per review + 5 per phrase saved + 30 per video + 50 per mastered phrase
    total_xp = (total_reviews * 15) + (total_phrases * 5) + (total_videos * 30) + (mastered_phrases * 50)

    # XP Level system: each level requires progressively more XP
    # Level 1: 0-100, Level 2: 100-250, Level 3: 250-500, Level 4: 500-800, etc.
    xp_remaining = total_xp
    xp_level = 1
    level_threshold = 100
    while xp_remaining >= level_threshold:
        xp_remaining -= level_threshold
        xp_level += 1
        level_threshold = int(level_threshold * 1.5)

    xp_in_current_level = xp_remaining
    xp_next_level = level_threshold

    # Weekly activity: reviews and phrases saved per day for last 7 days
    now = datetime.now(timezone.utc)
    weekly_activity = []
    for i in range(6, -1, -1):
        day = now - timedelta(days=i)
        day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)

        day_reviews = (
            db.query(PhraseReview)
            .join(SavedPhrase, PhraseReview.saved_phrase_id == SavedPhrase.id)
            .filter(
                SavedPhrase.user_id == current_user.id,
                PhraseReview.reviewed_at >= day_start,
                PhraseReview.reviewed_at < day_end
            )
            .count()
        )

        day_phrases = (
            db.query(SavedPhrase)
            .filter(
                SavedPhrase.user_id == current_user.id,
                SavedPhrase.created_at >= day_start,
                SavedPhrase.created_at < day_end
            )
            .count()
        )

        day_xp = (day_reviews * 15) + (day_phrases * 5)

        weekly_activity.append(DailyActivity(
            date=day_start.strftime("%Y-%m-%d"),
            reviews=day_reviews,
            phrases_saved=day_phrases,
            xp=day_xp
        ))

    return ProgressStatsResponse(
        total_videos=total_videos,
        total_phrases=total_phrases,
        mastered_phrases=mastered_phrases,
        learning_phrases=learning_phrases,
        total_reviews=total_reviews,
        current_streak=streak,
        level=level,
        total_xp=total_xp,
        xp_level=xp_level,
        xp_next_level=xp_next_level,
        xp_in_current_level=xp_in_current_level,
        weekly_activity=weekly_activity
    )
