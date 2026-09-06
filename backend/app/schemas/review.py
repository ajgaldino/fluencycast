from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict
from app.schemas.phrase import SavedPhraseResponse


class ReviewSubmitRequest(BaseModel):
    # Quality: 1 (Hard / Errou), 2 (Good / Bom), 3 (Easy / Fácil)
    quality: int = Field(..., ge=1, le=3, description="1=Hard, 2=Good, 3=Easy")


class ReviewResponse(BaseModel):
    id: str
    saved_phrase_id: str
    quality: int
    interval_days: int
    ease_factor: float
    reviewed_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DailyReviewSummary(BaseModel):
    due_phrases_count: int
    mastered_count: int
    learning_count: int
    streak_days: int
    reviewed_today_count: int = 0
