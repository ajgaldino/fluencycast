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


# High-frequency Phrasal Verbs & Conversational Chunks common in dialogues and songs
COMMON_PHRASAL_VERBS_AND_CHUNKS = [
    # Phrasal verbs
    "figure out", "point out", "find out", "give up", "give in", "look for", "look after", "look up to",
    "turn out", "turn down", "turn up", "turn on", "turn off", "carry on", "go on", "go through",
    "come up with", "come across", "run out of", "get along", "get over", "get by", "get back",
    "break down", "break up", "bring up", "bring about", "put off", "put up with", "hold on",
    "hang out", "deal with", "calm down", "settle down", "show up", "stand out", "take over",
    "take off", "check in", "check out", "fall apart", "pass out", "end up", "count on",
    # Conversational connectors and idioms (Mr. English Channel style)
    "fair enough", "to be honest", "as a matter of fact", "at the end of the day", "in the long run",
    "make sense", "make up your mind", "make up my mind", "catch up", "on the other hand",
    "by the way", "no worries", "never mind", "safe to say", "speak of the devil", "hit the nail on the head",
    "piece of cake", "under the weather", "so far so good", "keep in touch", "out of the blue"
]

COMMON_BASIC_WORDS = {
    "hello", "hi", "good", "morning", "afternoon", "night", "day", "yes", "no", "yeah", "yep",
    "please", "thanks", "thank", "welcome", "man", "woman", "boy", "girl", "friend", "people",
    "person", "name", "time", "year", "week", "month", "today", "tomorrow", "yesterday",
    "house", "home", "car", "room", "door", "water", "food", "book", "hand", "eye", "head",
    "face", "city", "country", "world", "school", "number", "money", "thing", "things"
}

def extract_keywords_for_video(
    video_id: str,
    user_id: str,
    db: Session,
    max_keywords: Optional[int] = 20
) -> List[SavedPhrase]:
    """
    Extracts high-value vocabulary:
    1. First prioritizes multi-word phrasal verbs and idioms (CHUNKS) found in the transcript!
    2. Then extracts relevant medium/advanced keywords, filtering out super basic words.
    3. Caps to max_keywords (default 20) to prevent deck drowning.
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

    full_transcript_lower = " ".join([seg.text.lower() for seg in segments])

    # 2. Existing items already saved for THIS specific video
    existing_video_items = {
        p.text.strip().lower()
        for p in db.query(SavedPhrase)
        .filter(
            SavedPhrase.user_id == user_id,
            SavedPhrase.video_id == video_id
        )
        .all()
        if p.text
    }

    items_to_create: List[Dict[str, Any]] = []
    seen_in_batch = set()

    # Priority A: Check for Phrasal Verbs & Chunks
    for chunk in COMMON_PHRASAL_VERBS_AND_CHUNKS:
        pattern = r'\b' + re.escape(chunk) + r'\b'
        if re.search(pattern, full_transcript_lower):
            if chunk not in existing_video_items and chunk not in seen_in_batch:
                # Find matching segment for context sentence and timestamp
                matching_seg = None
                for seg in segments:
                    if re.search(pattern, seg.text.lower()):
                        matching_seg = seg
                        break
                if matching_seg:
                    seen_in_batch.add(chunk)
                    items_to_create.append({
                        "text": chunk,
                        "type": "PHRASAL_VERB" if len(chunk.split()) <= 3 and any(chunk.startswith(v) for v in ["get", "look", "turn", "go", "come", "run", "take", "break", "put", "hold", "hang", "deal", "figure", "give", "carry"]) else "EXPRESSION",
                        "context_sentence": matching_seg.text.strip(),
                        "timestamp": matching_seg.start_time,
                        "segment_id": matching_seg.id
                    })

    # Priority B: Extract rich single words (lemmatized/cleaned, skipping basic words)
    target_limit = max_keywords if (max_keywords and max_keywords > 0) else 25

    for seg in segments:
        tokens = re.findall(r'\b[a-zA-Z]{4,}\b', seg.text)
        for t in tokens:
            clean_w = t.strip().lower()
            if clean_w in STOPWORDS or clean_w in COMMON_BASIC_WORDS:
                continue
            if clean_w in existing_video_items or clean_w in seen_in_batch:
                continue

            # Lemmatize plural 's' or 'es' if stem is valid
            stem_candidate = clean_w
            if clean_w.endswith("ies") and len(clean_w) > 4:
                stem_candidate = clean_w[:-3] + "y"
            elif clean_w.endswith("es") and len(clean_w) > 4 and clean_w[:-2] in CORE_DICTIONARY:
                stem_candidate = clean_w[:-2]
            elif clean_w.endswith("s") and len(clean_w) > 3 and clean_w[:-1] in CORE_DICTIONARY:
                stem_candidate = clean_w[:-1]

            item_term = stem_candidate if stem_candidate in CORE_DICTIONARY else clean_w
            if item_term in existing_video_items or item_term in seen_in_batch:
                continue

            seen_in_batch.add(item_term)
            items_to_create.append({
                "text": item_term,
                "type": "WORD",
                "context_sentence": seg.text.strip(),
                "timestamp": seg.start_time,
                "segment_id": seg.id
            })

            if len(items_to_create) >= target_limit:
                break
        if len(items_to_create) >= target_limit:
            break

    if not items_to_create:
        return []

    selected_items = items_to_create[:target_limit]

    # 3. Retrieve translations
    translations: Dict[str, str] = {}
    words_needing_translation: List[str] = []

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

    for item in selected_items:
        w = item["text"]
        clean = re.sub(r'[^a-zA-Z]', '', w.lower())
        if clean in CORE_DICTIONARY:
            translations[w] = CORE_DICTIONARY[clean]["translation"].split(",")[0].strip()
        elif w in _TRANSLATION_CACHE and _TRANSLATION_CACHE[w].strip().lower() != w.strip().lower():
            translations[w] = _TRANSLATION_CACHE[w]
        elif w in db_translations and db_translations[w].strip().lower() != w.strip().lower():
            translations[w] = db_translations[w]
        else:
            words_needing_translation.append(w)

    if words_needing_translation:
        def fetch_trans(word_to_tr: str):
            try:
                res = translate_text(TranslateRequest(text=word_to_tr), current_user=None)
                trans = res.translation.strip()
                if trans and trans.lower() != word_to_tr.lower():
                    return word_to_tr, trans
                return word_to_tr, ""
            except Exception:
                return word_to_tr, ""

        with ThreadPoolExecutor(max_workers=10) as pool:
            results = list(pool.map(fetch_trans, words_needing_translation))
            for w, tr in results:
                if tr and tr.strip().lower() != w.strip().lower():
                    translations[w] = tr

    # 4. Save entities
    now = datetime.now(timezone.utc)
    created_phrases: List[SavedPhrase] = []

    for item in selected_items:
        w = item["text"]
        trans = translations.get(w, "")
        if not trans or trans.strip().lower() == w.strip().lower() or trans == "Sem tradução cadastrada":
            clean_w = re.sub(r'[^a-zA-Z]', '', w.lower())
            if clean_w in CORE_DICTIONARY:
                trans = CORE_DICTIONARY[clean_w]["translation"].split(",")[0].strip()
            else:
                trans = "Significado em contexto"

        phrase = SavedPhrase(
            user_id=user_id,
            video_id=video_id,
            transcript_segment_id=item["segment_id"],
            text=w,
            translation=trans,
            context_sentence=item["context_sentence"],
            timestamp=item["timestamp"],
            phrase_type=item["type"],
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

