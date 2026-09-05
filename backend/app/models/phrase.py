import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, Integer, ForeignKey, Text, DateTime, Index
from sqlalchemy.orm import relationship
from app.core.database import Base


class SavedPhrase(Base):
    __tablename__ = "saved_phrases"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    video_id = Column(String(36), ForeignKey("videos.id", ondelete="CASCADE"), nullable=False, index=True)
    transcript_segment_id = Column(String(36), ForeignKey("transcript_segments.id", ondelete="SET NULL"), nullable=True)

    text = Column(Text, nullable=False)
    translation = Column(Text, nullable=True)
    context_sentence = Column(Text, nullable=True)
    timestamp = Column(Float, nullable=True)  # Video seconds where phrase occurs

    phrase_type = Column(String(30), default="SENTENCE")  # WORD, EXPRESSION, PHRASAL_VERB, SENTENCE
    difficulty = Column(String(20), default="NORMAL")     # EASY, NORMAL, HARD, STRUGGLE
    status = Column(String(20), default="NEW")           # NEW, LEARNING, REVIEW, MASTERED

    # Spaced Repetition (SM-2 Algorithm parameters)
    repetitions = Column(Integer, default=0)
    ease_factor = Column(Float, default=2.5)
    interval_days = Column(Integer, default=0)
    next_review_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    last_reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Relationships
    user = relationship("User", back_populates="saved_phrases")
    video = relationship("Video", back_populates="saved_phrases")
    segment = relationship("TranscriptSegment", back_populates="saved_phrases")
    reviews = relationship("PhraseReview", back_populates="phrase", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_saved_phrases_user_next_review", "user_id", "next_review_at"),
        Index("ix_saved_phrases_user_status", "user_id", "status"),
    )
