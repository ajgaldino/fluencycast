from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.phrase import SavedPhrase
from app.schemas.phrase import SavedPhraseCreate, SavedPhraseUpdate, SavedPhraseResponse

router = APIRouter()


@router.get("/", response_model=List[SavedPhraseResponse])
def get_saved_phrases(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    status: Optional[str] = Query(None, description="Filter by status: NEW, LEARNING, REVIEW, MASTERED"),
    skip: int = 0,
    limit: int = 100,
) -> Any:
    """
    Retrieve all saved phrases for the current user.
    """
    query = db.query(SavedPhrase).filter(SavedPhrase.user_id == current_user.id)
    if status:
        query = query.filter(SavedPhrase.status == status.upper())
    return query.order_by(SavedPhrase.created_at.desc()).offset(skip).limit(limit).all()


@router.post("/", response_model=SavedPhraseResponse, status_code=status.HTTP_201_CREATED)
def create_saved_phrase(
    phrase_in: SavedPhraseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Save a new phrase from a video segment.
    """
    phrase = SavedPhrase(
        user_id=current_user.id,
        video_id=phrase_in.video_id,
        transcript_segment_id=phrase_in.transcript_segment_id,
        text=phrase_in.text,
        translation=phrase_in.translation,
        context_sentence=phrase_in.context_sentence,
        timestamp=phrase_in.timestamp,
        phrase_type=phrase_in.phrase_type or "SENTENCE",
        difficulty=phrase_in.difficulty or "NORMAL",
        status="NEW"
    )
    db.add(phrase)
    db.commit()
    db.refresh(phrase)
    return phrase


@router.get("/{id}", response_model=SavedPhraseResponse)
def get_saved_phrase(
    id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Get a saved phrase by ID.
    """
    phrase = (
        db.query(SavedPhrase)
        .filter(SavedPhrase.id == id, SavedPhrase.user_id == current_user.id)
        .first()
    )
    if not phrase:
        raise HTTPException(status_code=404, detail="Phrase not found")
    return phrase


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_saved_phrase(
    id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """
    Delete a saved phrase.
    """
    phrase = (
        db.query(SavedPhrase)
        .filter(SavedPhrase.id == id, SavedPhrase.user_id == current_user.id)
        .first()
    )
    if not phrase:
        raise HTTPException(status_code=404, detail="Phrase not found")
    db.delete(phrase)
    db.commit()
