from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.video import Video
from app.models.transcript import TranscriptSegment
from app.schemas.video import VideoCreate, VideoResponse, VideoDetailResponse
from app.services.youtube import (
    extract_video_id,
    get_video_metadata,
    fetch_transcript,
    segment_transcript,
    parse_transcript_text
)

router = APIRouter()


@router.get("/", response_model=List[VideoResponse])
def get_user_videos(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    skip: int = 0,
    limit: int = 50,
) -> Any:
    """
    Retrieve all videos added by the current user.
    """
    videos = (
        db.query(Video)
        .filter(Video.user_id == current_user.id)
        .order_by(Video.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return videos


@router.post("/", response_model=VideoDetailResponse, status_code=status.HTTP_201_CREATED)
def create_video(
    video_in: VideoCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Process and add a new YouTube video for study:
    1. Validate URL and extract video ID
    2. Check if already added by this user (if so, return it)
    3. Fetch metadata (title, channel, thumbnail)
    4. Fetch transcript and segment into clean sentences
    5. Save video and segments in database
    """
    try:
        video_id = extract_video_id(video_in.url)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Check if user already added this video
    existing = (
        db.query(Video)
        .filter(Video.user_id == current_user.id, Video.youtube_id == video_id)
        .first()
    )
    if existing:
        return existing

    # 1. Fetch metadata
    meta = get_video_metadata(video_id)

    # 2. Fetch transcript & segment
    try:
        if video_in.raw_transcript and video_in.raw_transcript.strip():
            segments_data = parse_transcript_text(video_in.raw_transcript)
        else:
            raw_items = fetch_transcript(video_id)
            segments_data = segment_transcript(raw_items)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not segments_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Não foi possível obter uma transcrição para este vídeo. Certifique-se de que o vídeo possui legendas ativadas no YouTube ou cole a transcrição manualmente."
        )

    duration = segments_data[-1]["end_time"] if segments_data else 0.0

    video = Video(
        user_id=current_user.id,
        youtube_id=video_id,
        url=f"https://www.youtube.com/watch?v={video_id}",
        title=meta["title"],
        channel=meta["channel"],
        thumbnail_url=meta["thumbnail_url"],
        duration=duration,
        category=video_in.category or "video",
        language="en"
    )
    db.add(video)
    db.flush()

    # Create transcript segments
    for seg in segments_data:
        db_segment = TranscriptSegment(
            video_id=video.id,
            sequence=seg["sequence"],
            text=seg["text"],
            start_time=seg["start_time"],
            end_time=seg["end_time"]
        )
        db.add(db_segment)

    db.commit()
    db.refresh(video)
    return video


@router.get("/{id}", response_model=VideoDetailResponse)
def get_video_by_id(
    id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Get a specific video by ID with all synchronized transcript segments.
    """
    video = (
        db.query(Video)
        .filter(Video.id == id, Video.user_id == current_user.id)
        .first()
    )
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return video


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_video(
    id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """
    Delete a video and its segments.
    """
    video = (
        db.query(Video)
        .filter(Video.id == id, Video.user_id == current_user.id)
        .first()
    )
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    db.delete(video)
    db.commit()
