import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, List, Optional
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.v1.endpoints.ai import (
    _TRANSLATION_CACHE,
    translate_batch,
)
from app.models.phrase import SavedPhrase
from app.models.transcript import TranscriptSegment
from app.services.dictionary_data import (
    CORE_DICTIONARY,
    PHRASAL_VERBS_AND_CHUNKS,
    build_chunk_pattern,
    lemmatize_word,
    lookup_local_translation,
)

# Exported for backward compatibility with ai.py /chat
COMMON_PHRASAL_VERBS_AND_CHUNKS: List[str] = list(PHRASAL_VERBS_AND_CHUNKS.keys())

_COMPILED_CHUNK_PATTERNS = [
    (chunk, meta, build_chunk_pattern(chunk))
    for chunk, meta in PHRASAL_VERBS_AND_CHUNKS.items()
]

# Comprehensive English stopwords, conversation fillers, channel boilerplate, and proper names to skip
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
    # Spoken fillers, contractions, numbers, and musical markers
    "okay", "ok", "oh", "yes", "yeah", "yep", "hey", "just", "also", "really",
    "get", "got", "go", "goes", "going", "like", "one", "two", "three", "four",
    "five", "six", "seven", "eight", "nine", "ten", "gonna", "wanna", "gotta",
    "kinda", "sorta", "dude", "cool", "whoa", "huh", "umm", "um", "uh", "ah",
    "ha", "haha", "cause", "cuz", "alright", "yall", "guys", "guy", "bye",
    "hello", "hi", "etc", "la", "na", "something", "everything", "nothing", "anything",
    "don", "doesn", "didn", "haven", "hasn", "hadn", "won", "wouldn", "shouldn",
    "couldn", "aren", "isn", "wasn", "weren",
    # Residual transcript labels & channel boilerplate
    "segundo", "segundos", "minuto", "minutos", "hora", "horas", "music", "música", "musica",
    "emily", "paul", "english", "channel", "youtube", "podcast", "episode", "welcome",
    "everyone", "anyone", "someone", "everybody", "anybody", "somebody", "nobody",
    "goodbye", "thanks", "thank", "today", "tonight", "topic", "lesson", "video", "videos",
}

COMMON_BASIC_WORDS = {
    "hello", "hi", "good", "great", "nice", "fine", "best", "better", "morning",
    "afternoon", "night", "day", "days", "yes", "no", "yeah", "yep", "please",
    "thanks", "thank", "welcome", "man", "woman", "boy", "girl", "friend", "friends",
    "people", "person", "name", "time", "times", "year", "years", "week", "weeks",
    "month", "months", "today", "tomorrow", "yesterday", "house", "home", "car",
    "room", "door", "water", "food", "book", "hand", "eye", "head", "face",
    "city", "country", "world", "school", "number", "money", "thing", "things",
    "word", "words", "life", "work", "back", "ever", "else", "maybe", "every",
    "little", "still", "even", "well", "actually", "basically", "always", "never",
    "often", "already", "again", "another", "first", "second", "last", "next",
    "small", "long", "short", "high", "right", "left", "part", "place", "start",
    "starts", "started", "know", "knew", "feel", "felt", "make", "made", "take",
    "took", "come", "came", "give", "gave", "look", "looked", "looking", "want",
    "need", "said", "says", "tell", "told", "talk", "talking", "find", "found",
    "keep", "kept", "help", "helps", "mean", "try", "tried", "trying", "use",
    "used", "using", "easy", "hard", "real", "true", "sure", "kind", "sort",
    "able", "away", "around", "behind", "without", "across", "along", "toward",
    "towards", "since", "though", "although", "whether", "either", "neither",
    "learn", "learning", "learner", "learners", "practice", "write", "read",
    "listen", "listening", "speaking", "conversation", "answer", "question",
}

_RICH_SUFFIXES = (
    "tion", "sion", "ment", "ness", "ity", "ive", "ous",
    "ful", "less", "able", "ible", "ence", "ance", "ly",
)


def _score_word_candidate(term: str, freq: int, other_video_terms: set[str]) -> float:
    """Rank candidate words to surface genuinely useful B1-B2 vocabulary."""
    score = 0.0
    if len(term) >= 7:
        score += 3.0
    elif len(term) == 6:
        score += 2.0
    elif len(term) == 5:
        score += 1.0

    if term.endswith(_RICH_SUFFIXES):
        score += 2.0

    if 2 <= freq <= 6:
        score += 3.0
    elif freq > 6:
        score += 1.5
    else:
        score += 1.0

    if term not in other_video_terms:
        score += 2.0

    if term in CORE_DICTIONARY:
        score += 1.5

    return score


def _distribute_evenly(items: List[Any], cap: int) -> List[Any]:
    """Select up to `cap` items evenly spaced across a sorted timeline list."""
    if len(items) <= cap:
        return items
    step = len(items) / cap
    return [items[int(i * step)] for i in range(cap)]


def iter_extract_keywords_for_video(
    video_id: str,
    user_id: str,
    db: Session,
    max_keywords: Optional[int] = None,
    refresh: bool = False,
) -> Iterator[Dict[str, Any]]:
    """
    Extracts high-value phrasal verbs, conversational chunks, and B1-B2 vocabulary distributed
    evenly across the entire video (0% -> 100%), translating via local idiomatic dictionaries
    and grouped batch requests, while yielding SSE progress events.
    """
    segments = (
        db.query(TranscriptSegment)
        .filter(TranscriptSegment.video_id == video_id)
        .order_by(TranscriptSegment.sequence.asc())
        .all()
    )
    if not segments:
        yield {"stage": "keywords_done", "completed": 0, "total": 0, "phrases": []}
        return

    if refresh:
        # Replace only unreviewed auto-extracted cards; preserve user-saved SENTENCE & studied cards
        db.query(SavedPhrase).filter(
            SavedPhrase.user_id == user_id,
            SavedPhrase.video_id == video_id,
            SavedPhrase.status == "NEW",
            SavedPhrase.repetitions == 0,
            SavedPhrase.phrase_type.in_(["WORD", "PHRASAL_VERB", "EXPRESSION"]),
        ).delete(synchronize_session=False)
        db.flush()

    existing_video_items = {
        p.text.strip().lower()
        for p in db.query(SavedPhrase)
        .filter(
            SavedPhrase.user_id == user_id,
            SavedPhrase.video_id == video_id,
        )
        .all()
        if p.text
    }

    other_video_terms = {
        p.text.strip().lower()
        for p in db.query(SavedPhrase.text)
        .filter(
            SavedPhrase.user_id == user_id,
            SavedPhrase.video_id != video_id,
        )
        .all()
        if p.text
    }

    target_limit = max_keywords if (max_keywords and max_keywords > 0) else 35

    # Priority A: Match inflected phrasal verbs & conversational chunks across ALL segments
    chunk_candidates: List[Dict[str, Any]] = []
    seen_chunks: set[str] = set()
    non_intro_start_idx = 2 if len(segments) > 4 else 0

    for chunk, meta, pattern in _COMPILED_CHUNK_PATTERNS:
        if chunk in existing_video_items or chunk in seen_chunks:
            continue

        matching_seg = None
        fallback_intro_seg = None
        for idx, seg in enumerate(segments):
            if pattern.search(seg.text):
                if idx >= non_intro_start_idx:
                    matching_seg = seg
                    break
                if fallback_intro_seg is None:
                    fallback_intro_seg = seg

        chosen_seg = matching_seg or fallback_intro_seg
        if chosen_seg is not None:
            seen_chunks.add(chunk)
            chunk_candidates.append({
                "text": chunk,
                "type": meta["type"],
                "context_sentence": chosen_seg.text.strip(),
                "timestamp": chosen_seg.start_time,
                "segment_id": chosen_seg.id,
                "preset_translation": meta["translation"],
            })

    chunk_candidates.sort(key=lambda c: c["timestamp"])
    max_chunk_slots = min(15, target_limit)
    selected_chunks = _distribute_evenly(chunk_candidates, max_chunk_slots)
    seen_in_batch: set[str] = {c["text"] for c in selected_chunks}

    # Priority B: Scan ALL segments to gather non-intro word candidates & frequency
    word_stats: Dict[str, Dict[str, Any]] = {}
    proper_noun_flags: Dict[str, bool] = {}  # True if seen in lowercase or sentence-initial normal context

    for idx, seg in enumerate(segments):
        is_intro = idx < non_intro_start_idx
        for match in re.finditer(r"\b[a-zA-Z]{4,}\b", seg.text):
            raw_tok = match.group(0)
            clean_w = raw_tok.lower()
            if clean_w in STOPWORDS or clean_w in COMMON_BASIC_WORDS:
                continue

            item_term = lemmatize_word(clean_w)
            if (
                not item_term
                or len(item_term) < 4
                or item_term in STOPWORDS
                or item_term in COMMON_BASIC_WORDS
            ):
                continue
            if item_term in existing_video_items or item_term in seen_in_batch:
                continue

            # Detect mid-sentence proper names (capitalized after normal words, not in dictionary)
            prefix = seg.text[: match.start()].rstrip()
            at_sentence_start = not prefix or prefix.endswith((".", "!", "?", '"', "'", ":"))
            is_normal_usage = raw_tok.islower() or at_sentence_start or item_term in CORE_DICTIONARY
            if is_normal_usage:
                proper_noun_flags[item_term] = True
            else:
                proper_noun_flags.setdefault(item_term, False)

            if item_term not in word_stats:
                word_stats[item_term] = {
                    "term": item_term,
                    "freq": 0,
                    "seg": seg,
                    "seg_idx": idx,
                    "has_non_intro": False,
                }

            entry = word_stats[item_term]
            entry["freq"] += 1

            seg_len = len(seg.text.strip())
            cur_len = len(entry["seg"].text.strip())
            cur_is_ideal = 40 <= cur_len <= 180
            new_is_ideal = 40 <= seg_len <= 180

            if (not entry["has_non_intro"] and not is_intro) or (
                not is_intro and not cur_is_ideal and new_is_ideal
            ):
                entry["seg"] = seg
                entry["seg_idx"] = idx
                if not is_intro:
                    entry["has_non_intro"] = True

    # Filter out terms that only ever appeared capitalized mid-sentence
    word_candidates = [
        info for term, info in word_stats.items() if proper_noun_flags.get(term, True)
    ]

    word_budget = max(0, target_limit - len(selected_chunks))
    selected_words: List[Dict[str, Any]] = []

    if word_candidates and word_budget > 0:
        min_ts = segments[0].start_time
        max_ts = segments[-1].start_time
        span = max_ts - min_ts
        num_segs = max(len(segments), 1)
        num_buckets = 5
        buckets: List[List[tuple[float, Dict[str, Any]]]] = [[] for _ in range(num_buckets)]

        for info in word_candidates:
            score = _score_word_candidate(info["term"], info["freq"], other_video_terms)
            if span > 0:
                ratio = (info["seg"].start_time - min_ts) / span
            else:
                ratio = info["seg_idx"] / num_segs
            bucket_idx = min(num_buckets - 1, max(0, int(ratio * num_buckets)))
            buckets[bucket_idx].append((score, info))

        for bucket in buckets:
            bucket.sort(key=lambda item: (item[0], item[1]["freq"], len(item[1]["term"])), reverse=True)

        # Round-robin selection across the 5 timeline buckets guarantees 0% -> 100% video coverage
        while len(selected_words) < word_budget:
            picked_any = False
            for bucket in buckets:
                if bucket and len(selected_words) < word_budget:
                    _, chosen = bucket.pop(0)
                    seg = chosen["seg"]
                    seen_in_batch.add(chosen["term"])
                    selected_words.append({
                        "text": chosen["term"],
                        "type": "WORD",
                        "context_sentence": seg.text.strip(),
                        "timestamp": seg.start_time,
                        "segment_id": seg.id,
                    })
                    picked_any = True
            if not picked_any:
                break

        selected_words.sort(key=lambda w: w["timestamp"])

    selected_items = (selected_chunks + selected_words)[:target_limit]
    if not selected_items:
        yield {"stage": "keywords_done", "completed": 0, "total": 0, "phrases": []}
        return

    # 3. Retrieve idiomatic & accurate translations (preset -> local dict -> cache -> batch)
    translations: Dict[str, str] = {}
    words_needing_translation: List[str] = []

    db_translations = {
        p.text.strip().lower(): p.translation.strip()
        for p in db.query(SavedPhrase.text, SavedPhrase.translation)
        .filter(
            SavedPhrase.user_id == user_id,
            SavedPhrase.translation != None,
            SavedPhrase.translation != "",
        )
        .all()
        if p.text
        and p.translation
        and p.translation.strip() not in ("", "Sem tradução cadastrada", "Significado em contexto")
        and p.translation.strip().lower() != p.text.strip().lower()
    }

    for item in selected_items:
        w = item["text"]
        w_lower = w.strip().lower()

        if item.get("preset_translation"):
            translations[w] = item["preset_translation"]
            continue

        local_tr = lookup_local_translation(w)
        if local_tr:
            translations[w] = local_tr
            continue

        if w_lower in _TRANSLATION_CACHE and _TRANSLATION_CACHE[w_lower].strip().lower() != w_lower:
            translations[w] = _TRANSLATION_CACHE[w_lower]
            continue

        if w_lower in db_translations:
            translations[w] = db_translations[w_lower]
            continue

        words_needing_translation.append(w)

    already_translated = len(selected_items) - len(words_needing_translation)
    yield {
        "stage": "keywords_found",
        "total": len(selected_items),
        "completed": already_translated,
        "to_translate": len(words_needing_translation),
    }

    if words_needing_translation:
        done_count = already_translated
        batch_size = 15
        for start in range(0, len(words_needing_translation), batch_size):
            batch_terms = words_needing_translation[start : start + batch_size]
            try:
                batch_res = translate_batch(batch_terms, batch_size=batch_size)
                translations.update(batch_res)
            except Exception as err:
                print(f"[Vocabulary] Batch translation notice: {err}")

            done_count = min(len(selected_items), done_count + len(batch_terms))
            yield {
                "stage": "translating",
                "completed": done_count,
                "total": len(selected_items),
                "current_word": batch_terms[-1],
            }

    # 4. Save entities in bulk
    now = datetime.now(timezone.utc)
    created_ids: List[str] = []

    for item in selected_items:
        w = item["text"]
        trans = translations.get(w, "")
        if not trans or trans.strip().lower() == w.strip().lower() or trans == "Sem tradução cadastrada":
            local_fallback = lookup_local_translation(w)
            trans = local_fallback if local_fallback else "Significado em contexto"

        phrase_id = str(uuid.uuid4())
        phrase = SavedPhrase(
            id=phrase_id,
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
            created_at=now,
        )
        db.add(phrase)
        created_ids.append(phrase_id)

    db.commit()
    rows_by_id = (
        {p.id: p for p in db.query(SavedPhrase).filter(SavedPhrase.id.in_(created_ids)).all()}
        if created_ids
        else {}
    )
    created_phrases = [rows_by_id[pid] for pid in created_ids if pid in rows_by_id]

    yield {
        "stage": "keywords_done",
        "completed": len(selected_items),
        "total": len(selected_items),
        "phrases": created_phrases,
    }


def extract_keywords_for_video(
    video_id: str,
    user_id: str,
    db: Session,
    max_keywords: Optional[int] = None,
    refresh: bool = False,
) -> List[SavedPhrase]:
    """
    Extracts high-value phrasal verbs, idioms, and B1-B2 vocabulary distributed across
    the entire video and persists them as flashcards.
    """
    created_phrases: List[SavedPhrase] = []
    for event in iter_extract_keywords_for_video(
        video_id, user_id, db, max_keywords=max_keywords, refresh=refresh
    ):
        if event.get("stage") == "keywords_done":
            created_phrases = event.get("phrases", [])
    return created_phrases


def auto_repair_untranslated_phrases(user_id: str, db: Session, limit: int = 100) -> int:
    """
    Finds saved phrases/words belonging to this user where translation is missing,
    empty, or identical to the English original, and repairs them using local
    idiomatic dictionaries plus grouped batch translation.
    """
    untranslated_phrases = (
        db.query(SavedPhrase)
        .filter(
            SavedPhrase.user_id == user_id,
            or_(
                SavedPhrase.translation == None,
                SavedPhrase.translation == "",
                SavedPhrase.translation == "Sem tradução cadastrada",
                SavedPhrase.translation == "Significado em contexto",
                func.lower(func.trim(SavedPhrase.translation)) == func.lower(func.trim(SavedPhrase.text)),
            ),
        )
        .limit(limit)
        .all()
    )

    if not untranslated_phrases:
        return 0

    repaired_count = 0
    needs_online: List[SavedPhrase] = []

    for phrase in untranslated_phrases:
        orig_text = (phrase.text or "").strip()
        local_hit = lookup_local_translation(orig_text)
        if local_hit and local_hit.strip().lower() != orig_text.lower():
            phrase.translation = local_hit
            repaired_count += 1
        elif orig_text:
            needs_online.append(phrase)

    if needs_online:
        batch_results = translate_batch([p.text.strip() for p in needs_online if p.text])
        for phrase in needs_online:
            key = (phrase.text or "").strip()
            tr = batch_results.get(key)
            if tr and tr.strip().lower() != key.lower():
                phrase.translation = tr.strip()
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
