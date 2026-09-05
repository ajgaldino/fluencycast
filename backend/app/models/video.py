import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.core.database import Base


class Video(Base):
    __tablename__ = "videos"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    youtube_id = Column(String(30), nullable=False, index=True)
    url = Column(String(500), nullable=False)
    title = Column(String(500), nullable=False)
    channel = Column(String(255), nullable=True)
    thumbnail_url = Column(String(500), nullable=True)
    duration = Column(Float, nullable=True)
    language = Column(String(10), default="en")
    category = Column(String(30), default="video")  # "video" | "music"
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Relationships
    user = relationship("User", back_populates="videos")
    segments = relationship("TranscriptSegment", back_populates="video", cascade="all, delete-orphan", order_by="TranscriptSegment.sequence")
    saved_phrases = relationship("SavedPhrase", back_populates="video", cascade="all, delete-orphan")
