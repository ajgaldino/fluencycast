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

import re
from sqlalchemy import func
from app.services.vocabulary import get_video_filter_condition, auto_repair_untranslated_phrases
from app.api.v1.endpoints.ai import CORE_DICTIONARY, translate_text, TranslateRequest

@router.get("/summary", response_model=DailyReviewSummary)
def get_review_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    video_id: Optional[str] = Query(None, description="Filter summary by video ID"),
) -> Any:
    """
    Get summary of reviews: due count, mastered, learning, streak.
    Supports filtering by specific video_id or all videos if omitted.
    """
    now = datetime.now(timezone.utc)
    base_query = db.query(SavedPhrase).filter(SavedPhrase.user_id == current_user.id)
    if video_id and video_id.strip() and video_id.upper() != "ALL":
        base_query = base_query.filter(get_video_filter_condition(video_id, current_user.id, db))

    due_count = (
        base_query
        .filter(SavedPhrase.next_review_at <= now)
        .count()
    )
    mastered_count = (
        base_query
        .filter(SavedPhrase.status == "MASTERED")
        .count()
    )
    learning_count = (
        base_query
        .filter(SavedPhrase.status.in_(["NEW", "LEARNING", "REVIEW"]))
        .count()
    )
    streak = current_user.profile.current_streak if current_user.profile else 0

    # Count reviews done today
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    reviewed_today_query = (
        db.query(PhraseReview)
        .join(SavedPhrase, PhraseReview.saved_phrase_id == SavedPhrase.id)
        .filter(
            SavedPhrase.user_id == current_user.id,
            PhraseReview.reviewed_at >= today_start
        )
    )
    if video_id and video_id.strip() and video_id.upper() != "ALL":
        reviewed_today_query = reviewed_today_query.filter(get_video_filter_condition(video_id, current_user.id, db))
    reviewed_today = reviewed_today_query.count()

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
    phrase_type: Optional[str] = Query(None, description="SENTENCE, WORD, or ALL"),
    video_id: Optional[str] = Query(None, description="Filter cards by specific video ID"),
    all_cards: bool = False,
    limit: int = 100,
) -> Any:
    """
    Get phrases due for review according to spaced repetition schedule.
    If video_id is passed, filters to that video's cards and associated vocabulary.
    If all_cards=True, returns all saved phrases (free practice / cram mode).
    If all_cards=False, returns strictly phrases whose next_review_at <= now.
    """
    now = datetime.now(timezone.utc)
    query = db.query(SavedPhrase).filter(SavedPhrase.user_id == current_user.id)

    if video_id and video_id.strip() and video_id.upper() != "ALL":
        query = query.filter(get_video_filter_condition(video_id, current_user.id, db))

    if not all_cards:
        query = query.filter(SavedPhrase.next_review_at <= now)

    if phrase_type and phrase_type.upper() != "ALL":
        p_type = phrase_type.upper()
        if p_type == "SENTENCE":
            query = query.filter(func.upper(SavedPhrase.phrase_type) != "WORD")
        else:
            query = query.filter(func.upper(SavedPhrase.phrase_type) == p_type)

    # Auto-repair any untranslated cards in the user's library
    try:
        auto_repair_untranslated_phrases(current_user.id, db, limit=50)
    except Exception:
        pass

    phrases = query.order_by(SavedPhrase.next_review_at.asc()).all()

    # Deduplicate repeated words within the review session and ensure translation is present
    seen_words = set()
    deduped = []
    has_fixes = False

    for p in phrases:
        key = p.text.strip().lower() if (p.phrase_type or "").upper() == "WORD" else p.id
        if key not in seen_words:
            seen_words.add(key)

            # Safeguard: if translation equals text or is empty, repair immediately
            t_clean = (p.translation or "").strip().lower()
            txt_clean = (p.text or "").strip().lower()
            if not t_clean or t_clean == txt_clean or t_clean == "sem tradução cadastrada":
                clean_w = re.sub(r'[^a-zA-Z]', '', txt_clean)
                new_t = ""
                if clean_w in CORE_DICTIONARY:
                    new_t = CORE_DICTIONARY[clean_w]["translation"].split(",")[0].strip()
                elif clean_w.endswith('s') and len(clean_w) > 3 and clean_w[:-1] in CORE_DICTIONARY:
                    new_t = CORE_DICTIONARY[clean_w[:-1]]["translation"].split(",")[0].strip()
                elif clean_w.endswith('es') and len(clean_w) > 4 and clean_w[:-2] in CORE_DICTIONARY:
                    new_t = CORE_DICTIONARY[clean_w[:-2]]["translation"].split(",")[0].strip()
                else:
                    new_t = "Expressão em estudo"
                p.translation = new_t
                has_fixes = True

            deduped.append(p)
        if len(deduped) >= limit:
            break

    if has_fixes:
        try:
            db.commit()
        except Exception:
            db.rollback()

    return deduped


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
