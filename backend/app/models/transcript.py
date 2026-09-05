import uuid
from sqlalchemy import Column, String, Float, Integer, ForeignKey, Text, Index
from sqlalchemy.orm import relationship
from app.core.database import Base


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    video_id = Column(String(36), ForeignKey("videos.id", ondelete="CASCADE"), nullable=False, index=True)
    sequence = Column(Integer, nullable=False)
    text = Column(Text, nullable=False)
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)

    # Relationships
    video = relationship("Video", back_populates="segments")
    saved_phrases = relationship("SavedPhrase", back_populates="segment")

    __table_args__ = (
        Index("ix_transcript_segments_video_start", "video_id", "start_time"),
    )
