from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.phrase import SavedPhrase
from app.models.review import PhraseReview
from app.schemas.phrase import SavedPhraseResponse
from app.schemas.review import ReviewSubmitRequest, ReviewResponse, DailyReviewSummary

router = APIRouter()


@router.get("/summary", response_model=DailyReviewSummary)
def get_review_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Get summary of reviews: due count, mastered, learning, streak.
    """
    now = datetime.now(timezone.utc)
    due_count = (
        db.query(SavedPhrase)
        .filter(
            SavedPhrase.user_id == current_user.id,
            SavedPhrase.next_review_at <= now
        )
        .count()
    )
    mastered_count = (
        db.query(SavedPhrase)
        .filter(
            SavedPhrase.user_id == current_user.id,
            SavedPhrase.status == "MASTERED"
        )
        .count()
    )
    learning_count = (
        db.query(SavedPhrase)
        .filter(
            SavedPhrase.user_id == current_user.id,
            SavedPhrase.status.in_(["NEW", "LEARNING", "REVIEW"])
        )
        .count()
    )
    streak = current_user.profile.current_streak if current_user.profile else 0

    # Count reviews done today
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    reviewed_today = (
        db.query(PhraseReview)
        .join(SavedPhrase, PhraseReview.saved_phrase_id == SavedPhrase.id)
        .filter(
            SavedPhrase.user_id == current_user.id,
            PhraseReview.reviewed_at >= today_start
        )
        .count()
    )

    return DailyReviewSummary(
        due_phrases_count=due_count,
        mastered_count=mastered_count,
        learning_count=learning_count,
        streak_days=streak,
        reviewed_today_count=reviewed_today
    )


@router.get("/today", response_model=List[SavedPhraseResponse])
def get_today_reviews(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    phrase_type: Optional[str] = None,
    all_cards: bool = False,
    limit: int = 100,
) -> Any:
    """
    Get phrases due for review according to spaced repetition schedule.
    If all_cards=True, returns all saved phrases (free practice / cram mode).
    If all_cards=False, returns strictly phrases whose next_review_at <= now.
    """
    now = datetime.now(timezone.utc)
    query = db.query(SavedPhrase).filter(SavedPhrase.user_id == current_user.id)
    
    if not all_cards:
        query = query.filter(SavedPhrase.next_review_at <= now)

    if phrase_type:
        query = query.filter(SavedPhrase.phrase_type == phrase_type.upper())

    phrases = query.order_by(SavedPhrase.next_review_at.asc()).limit(limit).all()
    return phrases


@router.post("/{phrase_id}/submit", response_model=ReviewResponse)
def submit_phrase_review(
    phrase_id: str,
    review_in: ReviewSubmitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Submit a review for a phrase with quality grade:
    1 = Hard (😵 Errou / Difícil)
    2 = Good (😐 Lembrou com esforço / Bom)
    3 = Easy (😎 Lembrou facilmente / Fácil)
    Updates repetitions, ease factor, interval, and next review date.
    """
    phrase = (
        db.query(SavedPhrase)
        .filter(SavedPhrase.id == phrase_id, SavedPhrase.user_id == current_user.id)
        .first()
    )
    if not phrase:
        raise HTTPException(status_code=404, detail="Phrase not found")

    now = datetime.now(timezone.utc)
    q = review_in.quality

    # SM-2 simplified algorithm:
    # If Hard (q == 1): reset repetitions, interval becomes 1 day
    if q == 1:
        phrase.repetitions = 0
        phrase.interval_days = 1
        phrase.ease_factor = max(1.3, phrase.ease_factor - 0.2)
        phrase.status = "LEARNING"
    elif q == 2:
        if phrase.repetitions == 0:
            phrase.interval_days = 1
        elif phrase.repetitions == 1:
            phrase.interval_days = 3
        else:
            phrase.interval_days = int(phrase.interval_days * phrase.ease_factor)
        phrase.repetitions += 1
        phrase.status = "REVIEW"
    elif q == 3:
        if phrase.repetitions == 0:
            phrase.interval_days = 2
        elif phrase.repetitions == 1:
            phrase.interval_days = 6
        else:
            phrase.interval_days = int(phrase.interval_days * (phrase.ease_factor + 0.15))
        phrase.repetitions += 1
        phrase.ease_factor += 0.1
        if phrase.repetitions >= 5:
            phrase.status = "MASTERED"
        else:
            phrase.status = "REVIEW"

    phrase.last_reviewed_at = now
    phrase.next_review_at = now + timedelta(days=phrase.interval_days)

    review = PhraseReview(
        saved_phrase_id=phrase.id,
        quality=q,
        interval_days=phrase.interval_days,
        ease_factor=phrase.ease_factor,
        reviewed_at=now
    )
    db.add(review)

    # Update user streak if not studied today
    if current_user.profile:
        current_user.profile.last_study_date = now

    db.commit()
    db.refresh(review)
    return review
