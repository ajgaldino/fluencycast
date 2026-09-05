from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, HttpUrl, ConfigDict
from app.schemas.transcript import TranscriptSegmentResponse


class VideoCreate(BaseModel):
    url: str
    category: Optional[str] = "video"  # "video" | "music"
    raw_transcript: Optional[str] = None


class VideoResponse(BaseModel):
    id: str
    user_id: str
    youtube_id: str
    url: str
    title: str
    channel: Optional[str] = None
    thumbnail_url: Optional[str] = None
    duration: Optional[float] = None
    language: str
    category: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class VideoDetailResponse(VideoResponse):
    segments: List[TranscriptSegmentResponse] = []

    model_config = ConfigDict(from_attributes=True)
