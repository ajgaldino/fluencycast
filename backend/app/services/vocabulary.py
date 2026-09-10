import re
from typing import List, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.phrase import SavedPhrase
from app.models.transcript import TranscriptSegment
from app.api.v1.endpoints.ai import translate_text, TranslateRequest, CORE_DICTIONARY, _TRANSLATION_CACHE

# Comprehensive English stopwords and conversation fillers to skip
STOPWORDS = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
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
    "your", "yours", "yourself", "yourselves",
    # Spoken fillers, numbers, musical sounds
    "okay", "ok", "oh", "yes", "yeah", "yep", "hey", "just", "also", "really",
    "get", "go", "got", "like", "one", "two", "three", "four", "see",
    "gonna", "wanna", "gotta", "kinda", "sorta", "dude", "cool", "whoa", "huh",
    "umm", "um", "uh", "ah", "ha", "haha", "cause", "cuz", "alright", "yall",
    "guys", "guy", "bye", "hello", "hi", "etc", "la", "na", "something", "everything",
    # Contraction stems without apostrophe
    "don", "doesn", "didn", "haven", "hasn", "hadn", "won", "wouldn", "shouldn", "couldn",
    "aren", "isn", "wasn", "weren",
    # Residual transcript labels
    "segundo", "segundos", "minuto", "minutos", "hora", "horas", "music", "música", "musica"
}


def extract_keywords_for_video(
    video_id: str,
    user_id: str,
    db: Session,
    max_keywords: int = 150
) -> List[SavedPhrase]:
    """
    Extracts high-impact vocabulary words directly from a video's transcript segments,
    translates them into Portuguese, and creates SavedPhrase flashcards of type 'WORD'
    linked to that video.
    """
    # 1. Fetch transcript segments for this video
    segments = (
        db.query(TranscriptSegment)
        .filter(TranscriptSegment.video_id == video_id)
        .order_by(TranscriptSegment.sequence.asc())
        .all()
    )
    if not segments:
        return []

    # 2. All words already saved by this user (across ANY video or manual cards)
    # This guarantees NO duplicate words exist across different videos.
    existing_user_words = {
        re.sub(r'[^a-zA-Z]', '', p.text).strip().lower()
        for p in db.query(SavedPhrase)
        .filter(
            SavedPhrase.user_id == user_id,
            func.upper(SavedPhrase.phrase_type) == "WORD"
        )
        .all()
        if p.text
    }

    # 3. Frequency and context tracking across segments
    word_freq: Dict[str, int] = {}
    word_context: Dict[str, Dict[str, Any]] = {}

    for seg in segments:
        tokens = re.findall(r'\b[a-zA-Z]{3,}\b', seg.text)
        for t in tokens:
            clean_w = t.strip().lower()
            if clean_w in STOPWORDS:
                continue
            # Skip words already saved in ANY video or manual flashcards
            if clean_w in existing_user_words:
                continue

            word_freq[clean_w] = word_freq.get(clean_w, 0) + 1
            if clean_w not in word_context:
                word_context[clean_w] = {
                    "context_sentence": seg.text,
                    "timestamp": seg.start_time,
                    "segment_id": seg.id
                }

    if not word_freq:
        return []

    # 4. Score and rank candidates:
    # Strongly reward frequency in this specific video (+3 per repetition),
    # substantive word length 5-14 (+2), and core dictionary (+2)
    def word_score(w: str) -> float:
        score = word_freq[w] * 3.0
        if 5 <= len(w) <= 14:
            score += 2.0
        elif len(w) == 4:
            score += 1.0
        if w in CORE_DICTIONARY:
            score += 2.0
        return score

    sorted_candidates = sorted(word_freq.keys(), key=word_score, reverse=True)
    selected_words = sorted_candidates[:max_keywords]

    # 5. Fast translation retrieval:
    # Check CORE_DICTIONARY, in-memory cache, or pre-existing DB translations
    translations: Dict[str, str] = {}
    words_needing_translation: List[str] = []

    # Pre-fetch existing translations from user's other cards if available
    db_translations = {
        p.text.lower(): p.translation
        for p in db.query(SavedPhrase.text, SavedPhrase.translation)
        .filter(
            SavedPhrase.user_id == user_id,
            SavedPhrase.translation != None,
            SavedPhrase.translation != ""
        )
        .all()
        if p.translation
    }

    for w in selected_words:
        if w in CORE_DICTIONARY:
            translations[w] = CORE_DICTIONARY[w]["translation"].split(",")[0].strip()
        elif w in _TRANSLATION_CACHE:
            translations[w] = _TRANSLATION_CACHE[w]
        elif w in db_translations:
            translations[w] = db_translations[w]
        else:
            words_needing_translation.append(w)

    # Concurrently translate remaining words
    if words_needing_translation:
        def fetch_trans(word_to_tr: str):
            try:
                res = translate_text(TranslateRequest(text=word_to_tr), current_user=None)
                trans = res.translation.strip()
                if trans and trans.lower() != word_to_tr.lower():
                    return word_to_tr, trans
                if word_to_tr in CORE_DICTIONARY:
                    return word_to_tr, CORE_DICTIONARY[word_to_tr]["translation"].split(",")[0].strip()
                return word_to_tr, word_to_tr
            except Exception:
                return word_to_tr, word_to_tr

        with ThreadPoolExecutor(max_workers=10) as pool:
            results = list(pool.map(fetch_trans, words_needing_translation))
            for w, tr in results:
                translations[w] = tr

    # 6. Create SavedPhrase flashcard entities
    now = datetime.now(timezone.utc)
    created_phrases: List[SavedPhrase] = []

    for w in selected_words:
        ctx = word_context[w]
        trans = translations.get(w, w)
        phrase = SavedPhrase(
            user_id=user_id,
            video_id=video_id,
            transcript_segment_id=ctx["segment_id"],
            text=w,
            translation=trans,
            context_sentence=ctx["context_sentence"],
            timestamp=ctx["timestamp"],
            phrase_type="WORD",
            difficulty="NORMAL",
            status="NEW",
            repetitions=0,
            ease_factor=2.5,
            interval_days=0,
            next_review_at=now,
            created_at=now
        )
        db.add(phrase)
        created_phrases.append(phrase)

    db.commit()
    for p in created_phrases:
        db.refresh(p)

    return created_phrases


def get_video_filter_condition(video_id: str, user_id: str, db: Session):
    """
    Builds a filter condition for phrases associated with a given video.
    Includes:
    1. Saved phrases directly tied to this video (video_id).
    2. Any saved WORD cards belonging to the user whose text is present in this
       video's transcript segments, enabling seamless study of video vocabulary
       without duplicating cards across different videos.
    """
    from sqlalchemy import or_, and_

    # 1. Fetch user's saved words
    user_words = [
        re.sub(r'[^a-zA-Z]', '', p.text).strip().lower()
        for p in db.query(SavedPhrase.text)
        .filter(
            SavedPhrase.user_id == user_id,
            func.upper(SavedPhrase.phrase_type) == "WORD"
        )
        .all()
        if p.text
    ]

    if not user_words:
        return SavedPhrase.video_id == video_id

    # 2. Fetch words from this video's transcript segments
    segments = db.query(TranscriptSegment.text).filter(TranscriptSegment.video_id == video_id).all()
    if not segments:
        return SavedPhrase.video_id == video_id

    video_tokens = set()
    for (seg_text,) in segments:
        for match in re.findall(r'\b[a-zA-Z]{3,}\b', seg_text.lower()):
            video_tokens.add(match)

    # 3. Intersection: user words present in this video
    matching_user_words = [w for w in set(user_words) if w in video_tokens]

    if matching_user_words:
        return or_(
            SavedPhrase.video_id == video_id,
            and_(
                func.upper(SavedPhrase.phrase_type) == "WORD",
                func.lower(SavedPhrase.text).in_(matching_user_words)
            )
        )

    return SavedPhrase.video_id == video_id

