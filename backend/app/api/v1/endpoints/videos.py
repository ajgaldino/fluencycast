from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.video import Video
from app.schemas.video import VideoCreate, VideoResponse, VideoDetailResponse

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
