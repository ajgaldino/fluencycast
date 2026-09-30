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
    max_keywords: Optional[int] = None
) -> List[SavedPhrase]:
    """
    Extracts vocabulary words directly from ALL transcript segments of a video,
    translates them into Portuguese, and creates individual SavedPhrase flashcards of type 'WORD'
    linked to that specific video.
    """
    # 1. Fetch all transcript segments for this video
    segments = (
        db.query(TranscriptSegment)
        .filter(TranscriptSegment.video_id == video_id)
        .order_by(TranscriptSegment.sequence.asc())
        .all()
    )
    if not segments:
        return []

    # 2. Existing words already saved for THIS specific video (avoids duplicate cards within this video)
    existing_video_words = {
        re.sub(r'[^a-zA-Z]', '', p.text).strip().lower()
        for p in db.query(SavedPhrase)
        .filter(
            SavedPhrase.user_id == user_id,
            SavedPhrase.video_id == video_id,
            func.upper(SavedPhrase.phrase_type) == "WORD"
        )
        .all()
        if p.text
    }

    # 3. Look at ALL sentences of the video and extract vocabulary words from all of them
    words_to_create: List[str] = []
    word_context: Dict[str, Dict[str, Any]] = {}
    seen_in_batch = set()

    for seg in segments:
        tokens = re.findall(r'\b[a-zA-Z]{3,}\b', seg.text)
        for t in tokens:
            clean_w = t.strip().lower()
            if clean_w in STOPWORDS:
                continue
            if clean_w in existing_video_words:
                continue
            if clean_w in seen_in_batch:
                continue

            seen_in_batch.add(clean_w)
            words_to_create.append(clean_w)
            word_context[clean_w] = {
                "context_sentence": seg.text.strip(),
                "timestamp": seg.start_time,
                "segment_id": seg.id
            }

    if not words_to_create:
        return []

    # If max_keywords is explicitly specified and > 0, limit; otherwise extract all words from all sentences
    if max_keywords and max_keywords > 0:
        selected_words = words_to_create[:max_keywords]
    else:
        selected_words = words_to_create

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
        clean = re.sub(r'[^a-zA-Z]', '', w.lower())
        if clean in CORE_DICTIONARY:
            translations[w] = CORE_DICTIONARY[clean]["translation"].split(",")[0].strip()
        elif clean.endswith('s') and len(clean) > 3 and clean[:-1] in CORE_DICTIONARY:
            translations[w] = CORE_DICTIONARY[clean[:-1]]["translation"].split(",")[0].strip()
        elif clean.endswith('es') and len(clean) > 4 and clean[:-2] in CORE_DICTIONARY:
            translations[w] = CORE_DICTIONARY[clean[:-2]]["translation"].split(",")[0].strip()
        elif clean.endswith('ing') and len(clean) > 4 and clean[:-3] in CORE_DICTIONARY:
            translations[w] = CORE_DICTIONARY[clean[:-3]]["translation"].split(",")[0].strip()
        elif clean.endswith('ed') and len(clean) > 4 and clean[:-2] in CORE_DICTIONARY:
            translations[w] = CORE_DICTIONARY[clean[:-2]]["translation"].split(",")[0].strip()
        elif w in _TRANSLATION_CACHE and _TRANSLATION_CACHE[w].strip().lower() != w.strip().lower():
            translations[w] = _TRANSLATION_CACHE[w]
        elif w in db_translations and db_translations[w].strip().lower() != w.strip().lower():
            translations[w] = db_translations[w]
        else:
            words_needing_translation.append(w)

    # Concurrently translate remaining words
    if words_needing_translation:
        def fetch_trans(word_to_tr: str):
            try:
                clean_w = re.sub(r'[^a-zA-Z]', '', word_to_tr.lower())
                if clean_w in CORE_DICTIONARY:
                    return word_to_tr, CORE_DICTIONARY[clean_w]["translation"].split(",")[0].strip()
                res = translate_text(TranslateRequest(text=word_to_tr), current_user=None)
                trans = res.translation.strip()
                if trans and trans.lower() != word_to_tr.lower():
                    return word_to_tr, trans
                if clean_w.endswith('s') and len(clean_w) > 3 and clean_w[:-1] in CORE_DICTIONARY:
                    return word_to_tr, CORE_DICTIONARY[clean_w[:-1]]["translation"].split(",")[0].strip()
                return word_to_tr, ""
            except Exception:
                return word_to_tr, ""

        with ThreadPoolExecutor(max_workers=10) as pool:
            results = list(pool.map(fetch_trans, words_needing_translation))
            for w, tr in results:
                if tr and tr.strip().lower() != w.strip().lower():
                    translations[w] = tr

    # 6. Create SavedPhrase flashcard entities
    now = datetime.now(timezone.utc)
    created_phrases: List[SavedPhrase] = []

    for w in selected_words:
        ctx = word_context[w]
        clean_w = re.sub(r'[^a-zA-Z]', '', w.lower())
        trans = translations.get(w, "")
        if not trans or trans.strip().lower() == w.strip().lower() or trans == "Sem tradução cadastrada":
            if clean_w in CORE_DICTIONARY:
                trans = CORE_DICTIONARY[clean_w]["translation"].split(",")[0].strip()
            elif clean_w.endswith('s') and len(clean_w) > 3 and clean_w[:-1] in CORE_DICTIONARY:
                trans = CORE_DICTIONARY[clean_w[:-1]]["translation"].split(",")[0].strip()
            else:
                trans = "Expressão em estudo"

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


def auto_repair_untranslated_phrases(user_id: str, db: Session, limit: int = 100) -> int:
    """
    Finds saved phrases/words belonging to this user where translation is missing,
    empty, or identical to the English original (e.g. 'quick' -> 'quick').
    Translates them using CORE_DICTIONARY and online fallbacks, and persists the
    repaired translation to the database.
    Returns the number of repaired phrases.
    """
    from sqlalchemy import or_

    untranslated_phrases = (
        db.query(SavedPhrase)
        .filter(
            SavedPhrase.user_id == user_id,
            or_(
                SavedPhrase.translation == None,
                SavedPhrase.translation == "",
                SavedPhrase.translation == "Sem tradução cadastrada",
                func.lower(func.trim(SavedPhrase.translation)) == func.lower(func.trim(SavedPhrase.text))
            )
        )
        .limit(limit)
        .all()
    )

    if not untranslated_phrases:
        return 0

    repaired_count = 0
    for phrase in untranslated_phrases:
        text_clean = (phrase.text or "").strip().lower()
        clean_w = re.sub(r'[^a-zA-Z]', '', text_clean)

        new_trans = ""
        # 1. CORE_DICTIONARY check
        if clean_w in CORE_DICTIONARY:
            new_trans = CORE_DICTIONARY[clean_w]["translation"].split(",")[0].strip()
        elif clean_w.endswith('s') and len(clean_w) > 3 and clean_w[:-1] in CORE_DICTIONARY:
            new_trans = CORE_DICTIONARY[clean_w[:-1]]["translation"].split(",")[0].strip()
        elif clean_w.endswith('es') and len(clean_w) > 4 and clean_w[:-2] in CORE_DICTIONARY:
            new_trans = CORE_DICTIONARY[clean_w[:-2]]["translation"].split(",")[0].strip()
        elif clean_w.endswith('ing') and len(clean_w) > 4 and clean_w[:-3] in CORE_DICTIONARY:
            new_trans = CORE_DICTIONARY[clean_w[:-3]]["translation"].split(",")[0].strip()
        elif clean_w.endswith('ed') and len(clean_w) > 4 and clean_w[:-2] in CORE_DICTIONARY:
            new_trans = CORE_DICTIONARY[clean_w[:-2]]["translation"].split(",")[0].strip()

        # 2. Online translate fallback
        if not new_trans:
            try:
                res = translate_text(TranslateRequest(text=phrase.text), current_user=None)
                if res.translation and res.translation.strip().lower() != text_clean:
                    new_trans = res.translation.strip()
            except Exception:
                pass

        if new_trans and new_trans.strip().lower() != text_clean:
            phrase.translation = new_trans
            repaired_count += 1

    if repaired_count > 0:
        try:
            db.commit()
        except Exception:
            db.rollback()

    return repaired_count


def get_video_filter_condition(video_id: str, user_id: str, db: Session):
    """
    Builds a filter condition for phrases associated with a given video.
    Cards are individual per video (video_id).
    """
    return SavedPhrase.video_id == video_id

