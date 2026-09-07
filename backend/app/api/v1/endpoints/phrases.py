from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

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
    phrase_type: Optional[str] = Query(None, description="Filter by phrase_type: SENTENCE, WORD, etc."),
    skip: int = 0,
    limit: int = 100,
) -> Any:
    """
    Retrieve all saved phrases for the current user.
    Supports filtering by status and phrase_type (SENTENCE vs WORD).
    """
    query = db.query(SavedPhrase).filter(SavedPhrase.user_id == current_user.id)
    if status:
        query = query.filter(SavedPhrase.status == status.upper())
    if phrase_type:
        p_type = phrase_type.upper()
        if p_type == "SENTENCE":
            query = query.filter(func.upper(SavedPhrase.phrase_type) != "WORD")
        else:
            query = query.filter(func.upper(SavedPhrase.phrase_type) == p_type)
    return query.order_by(SavedPhrase.created_at.desc()).offset(skip).limit(limit).all()


@router.post("/", response_model=SavedPhraseResponse, status_code=status.HTTP_201_CREATED)
def create_saved_phrase(
    phrase_in: SavedPhraseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Save a new phrase manually or from a video segment.
    Prevents duplicate WORD cards for the same user while keeping them updated.
    """
    clean_text = phrase_in.text.strip()
    if not clean_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O texto da frase ou palavra não pode ser vazio."
        )

    p_type = (phrase_in.phrase_type or "SENTENCE").upper()

    # Deduplicate single words: if already exists, update translation/context and return
    if p_type == "WORD":
        existing = db.query(SavedPhrase).filter(
            SavedPhrase.user_id == current_user.id,
            func.upper(SavedPhrase.phrase_type) == "WORD",
            func.lower(SavedPhrase.text) == clean_text.lower()
        ).first()
        if existing:
            updated = False
            if not existing.translation and phrase_in.translation:
                existing.translation = phrase_in.translation
                updated = True
            if not existing.context_sentence and phrase_in.context_sentence:
                existing.context_sentence = phrase_in.context_sentence
                updated = True
            if updated:
                db.commit()
                db.refresh(existing)
            return existing

    phrase = SavedPhrase(
        user_id=current_user.id,
        video_id=phrase_in.video_id,
        transcript_segment_id=phrase_in.transcript_segment_id,
        text=clean_text,
        translation=phrase_in.translation,
        context_sentence=phrase_in.context_sentence,
        timestamp=phrase_in.timestamp,
        phrase_type=p_type,
        difficulty=(phrase_in.difficulty or "NORMAL").upper(),
        status=(phrase_in.status or "NEW").upper()
    )
    db.add(phrase)
    db.commit()
    db.refresh(phrase)
    return phrase


STOPWORDS = {
    "a", "above", "after", "again", "against", "all", "am", "an", "and",
    "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being",
    "below", "between", "both", "but", "by", "can", "can't", "cannot", "could",
    "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down",
    "during", "each", "few", "for", "from", "further", "had", "hadn't", "has",
    "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her",
    "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's",
    "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it",
    "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my",
    "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or",
    "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same",
    "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so",
    "some", "such", "than", "that", "that's", "the", "their", "theirs", "them",
    "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll",
    "they're", "they've", "this", "those", "through", "to", "too", "under",
    "until", "up", "very", "was", "wasn't", "we", "we'd", "we'll", "we're",
    "we've", "were", "weren't", "what", "what's", "when", "when's", "where",
    "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with",
    "won't", "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've",
    "your", "yours", "yourself", "yourselves", "okay", "oh", "yes", "yeah", "hey",
    "just", "also", "really", "get", "go", "got", "like", "one", "two", "see"
}


@router.post("/extract-words", response_model=List[SavedPhraseResponse])
def extract_words_from_phrases(
    video_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Extracts key vocabulary words from saved phrases and creates dedicated WORD flashcards
    with sentence context and automatic Portuguese translation.
    Strictly avoids duplicate words (case-insensitive deduplication).
    """
    import re
    from app.api.v1.endpoints.ai import translate_text, TranslateRequest, CORE_DICTIONARY

    query = db.query(SavedPhrase).filter(SavedPhrase.user_id == current_user.id)
    if video_id:
        query = query.filter(SavedPhrase.video_id == video_id)

    saved_sentences = query.filter(func.upper(SavedPhrase.phrase_type) != "WORD").all()
    if not saved_sentences:
        saved_sentences = query.all()

    existing_words = {
        re.sub(r'[^a-zA-Z]', '', p.text).strip().lower()
        for p in db.query(SavedPhrase)
        .filter(SavedPhrase.user_id == current_user.id, func.upper(SavedPhrase.phrase_type) == "WORD")
        .all()
    }

    created_word_cards = []
    seen_in_batch = set()

    for item in saved_sentences:
        raw_words = re.findall(r'\b[a-zA-Z]{3,}\b', item.text)
        candidates = []
        for w in raw_words:
            clean_w = w.strip().lower()
            if (
                clean_w not in STOPWORDS
                and clean_w not in existing_words
                and clean_w not in seen_in_batch
            ):
                candidates.append(clean_w)
                seen_in_batch.add(clean_w)
                existing_words.add(clean_w)

        for word in candidates[:10]:
            tr = translate_text(TranslateRequest(text=word), current_user=current_user)
            trans = tr.translation if tr.translation.lower() != word else ""
            if not trans and word in CORE_DICTIONARY:
                trans = CORE_DICTIONARY[word]["translation"].split(",")[0].strip()

            word_phrase = SavedPhrase(
                user_id=current_user.id,
                video_id=item.video_id,
                transcript_segment_id=item.transcript_segment_id,
                text=word,
                translation=trans,
                context_sentence=item.text,
                timestamp=item.timestamp,
                phrase_type="WORD",
                difficulty="NORMAL",
                status="NEW"
            )
            db.add(word_phrase)
            created_word_cards.append(word_phrase)

            if len(created_word_cards) >= 60:
                break
        if len(created_word_cards) >= 60:
            break

    db.commit()
    for p in created_word_cards:
        db.refresh(p)

    return created_word_cards


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


@router.put("/{id}", response_model=SavedPhraseResponse)
def update_saved_phrase(
    id: str,
    phrase_in: SavedPhraseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Update a saved phrase (text, translation, context, difficulty, status).
    """
    phrase = (
        db.query(SavedPhrase)
        .filter(SavedPhrase.id == id, SavedPhrase.user_id == current_user.id)
        .first()
    )
    if not phrase:
        raise HTTPException(status_code=404, detail="Phrase not found")

    if phrase_in.text is not None:
        phrase.text = phrase_in.text
    if phrase_in.translation is not None:
        phrase.translation = phrase_in.translation
    if phrase_in.context_sentence is not None:
        phrase.context_sentence = phrase_in.context_sentence
    if phrase_in.difficulty is not None:
        phrase.difficulty = phrase_in.difficulty
    if phrase_in.status is not None:
        phrase.status = phrase_in.status

    db.commit()
    db.refresh(phrase)
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
