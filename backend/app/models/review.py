import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, Integer, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from app.core.database import Base


class PhraseReview(Base):
    __tablename__ = "phrase_reviews"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    saved_phrase_id = Column(String(36), ForeignKey("saved_phrases.id", ondelete="CASCADE"), nullable=False, index=True)
    quality = Column(Integer, nullable=False)  # 1 (Hard), 2 (Good), 3 (Easy) or SM-2 0-5
    interval_days = Column(Integer, nullable=False)
    ease_factor = Column(Float, nullable=False)
    reviewed_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    phrase = relationship("SavedPhrase", back_populates="reviews")


class StudySession(Base):
    __tablename__ = "study_sessions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    video_id = Column(String(36), ForeignKey("videos.id", ondelete="SET NULL"), nullable=True)
    duration_seconds = Column(Integer, default=0)
    phrases_reviewed = Column(Integer, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="study_sessions")
