from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class SavedPhraseCreate(BaseModel):
    video_id: Optional[str] = None
    transcript_segment_id: Optional[str] = None
    text: str
    translation: Optional[str] = None
    context_sentence: Optional[str] = None
    timestamp: Optional[float] = None
    phrase_type: Optional[str] = "SENTENCE"  # WORD, EXPRESSION, PHRASAL_VERB, SENTENCE
    difficulty: Optional[str] = "NORMAL"
    status: Optional[str] = "NEW"


class SavedPhraseUpdate(BaseModel):
    text: Optional[str] = None
    translation: Optional[str] = None
    context_sentence: Optional[str] = None
    difficulty: Optional[str] = None
    status: Optional[str] = None


class SavedPhraseResponse(BaseModel):
    id: str
    user_id: str
    video_id: Optional[str] = None
    transcript_segment_id: Optional[str] = None
    text: str
    translation: Optional[str] = None
    context_sentence: Optional[str] = None
    timestamp: Optional[float] = None
    phrase_type: str
    difficulty: str
    status: str
    repetitions: int
    ease_factor: float
    interval_days: int
    next_review_at: datetime
    last_reviewed_at: Optional[datetime] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
