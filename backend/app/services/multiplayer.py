"""Multiplayer matchmaking & real-time word games (MD5 Hangman & Scramble)."""
import random
import re
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.game import MatchQueue, MultiplayerMatch
from app.models.phrase import SavedPhrase
from app.services import gamification as gm
from app.services.achievements import check_achievements
from app.services.dictionary_data import CORE_DICTIONARY

HANGMAN_MAX_ERRORS = 6
HANGMAN_ROUNDS = 5
HANGMAN_WIN_SCORE = 3  # MD5: first to 3 wins (or highest after 5 rounds)
SCRAMBLE_ROUNDS = 5
XP_MP_WIN = 30
XP_MP_DRAW = 15
XP_MP_PLAY = 10

_WORD_RE = re.compile(r"\b[a-zA-Z]{4,12}\b")

BUILTIN_WORDS: List[Tuple[str, str]] = [
    ("music", "música"), ("dream", "sonho"), ("heart", "coração"), ("night", "noite"),
    ("light", "luz"), ("smile", "sorriso"), ("dance", "dançar"), ("voice", "voz"),
    ("river", "rio"), ("ocean", "oceano"), ("cloud", "nuvem"), ("storm", "tempestade"),
    ("flame", "chama"), ("story", "história"), ("peace", "paz"), ("world", "mundo"),
    ("memory", "memória"), ("shadow", "sombra"), ("bridge", "ponte"), ("sunset", "pôr do sol"),
    ("garden", "jardim"), ("flower", "flor"), ("summer", "verão"), ("winter", "inverno"),
    ("friend", "amigo"), ("coffee", "café"), ("window", "janela"), ("mirror", "espelho"),
    ("heaven", "céu / paraíso"), ("island", "ilha"), ("freedom", "liberdade"), ("silence", "silêncio"),
    ("journey", "jornada"), ("rainbow", "arco-íris"), ("morning", "manhã"), ("whisper", "sussurro"),
    ("promise", "promessa"), ("thunder", "trovão"), ("believe", "acreditar"), ("forever", "para sempre"),
]


def _clean_hint(raw: str) -> str:
    return raw.split(",")[0].strip()


def _pick_words(db: Session, user_ids: List[str], count: int) -> List[Tuple[str, str]]:
    """Build a vast word pool prioritizing the players' own saved words & sentences,
    then other users' words, then CORE_DICTIONARY + BUILTIN_WORDS."""
    player_words: Dict[str, str] = {}
    all_user_words: Dict[str, str] = {}
    fallback_pool: Dict[str, str] = {w: h for w, h in BUILTIN_WORDS}

    for word, meta in CORE_DICTIONARY.items():
        w = word.strip().lower()
        if 4 <= len(w) <= 12 and w.isalpha() and w.isascii():
            tr = _clean_hint(meta.get("translation", ""))
            if tr:
                fallback_pool.setdefault(w, tr)

    rows = db.query(SavedPhrase).filter(SavedPhrase.text.isnot(None)).all()
    user_set = set(user_ids)
    for r in rows:
        is_player = r.user_id in user_set
        w = (r.text or "").strip().lower()
        h = (r.translation or "").strip()

        # Direct saved word
        if 4 <= len(w) <= 12 and w.isalpha() and w.isascii() and h and h.lower() != w:
            if is_player:
                player_words.setdefault(w, _clean_hint(h))
            else:
                all_user_words.setdefault(w, _clean_hint(h))

        # Also extract vocabulary words from players' saved sentences/lyrics!
        if is_player:
            for source in (r.text, r.context_sentence):
                for tok in _WORD_RE.findall(source or ""):
                    tl = tok.lower()
                    if tl in CORE_DICTIONARY:
                        tr = _clean_hint(CORE_DICTIONARY[tl].get("translation", ""))
                        if tr:
                            player_words.setdefault(tl, tr)

    chosen: Dict[str, str] = {}
    # Prioritize up to `count` words from players' own study material (shuffled)
    p_items = list(player_words.items())
    random.shuffle(p_items)
    for w, h in p_items[:count]:
        chosen[w] = h

    # Fill any remaining slots from other users' words, then CORE_DICTIONARY
    if len(chosen) < count:
        others = [(w, h) for w, h in all_user_words.items() if w not in chosen]
        random.shuffle(others)
        for w, h in others:
            chosen[w] = h
            if len(chosen) >= count:
                break

    if len(chosen) < count:
        fb = [(w, h) for w, h in fallback_pool.items() if w not in chosen]
        random.shuffle(fb)
        for w, h in fb:
            chosen[w] = h
            if len(chosen) >= count:
                break

    result = list(chosen.items())
    random.shuffle(result)
    return result


def _scramble(word: str) -> str:
    letters = list(word)
    for _ in range(10):
        random.shuffle(letters)
        out = "".join(letters)
        if out != word:
            return out
    return word[::-1]


def init_match_state(db: Session, game_type: str, p1_id: str, p2_id: str) -> dict:
    if game_type == "HANGMAN":
        chosen = _pick_words(db, [p1_id, p2_id], HANGMAN_ROUNDS)
        rounds = [
            {
                "word": w,
                "hint": h,
                "p1_guessed": [],
                "p2_guessed": [],
                "p1_wrong": 0,
                "p2_wrong": 0,
                "p1_status": "PLAYING",
                "p2_status": "PLAYING",
                "winner_id": None,
            }
            for w, h in chosen
        ]
        return {
            "rounds": rounds,
            "round_index": 0,
            "p1_score": 0,
            "p2_score": 0,
        }

    chosen = _pick_words(db, [p1_id, p2_id], SCRAMBLE_ROUNDS)
    rounds = [{"word": w, "scrambled": _scramble(w), "hint": h, "winner_id": None} for w, h in chosen]
    return {
        "rounds": rounds,
        "round_index": 0,
        "p1_score": 0,
        "p2_score": 0,
    }


def _finalize_match(db: Session, match: MultiplayerMatch, winner_id: Optional[str]) -> None:
    match.status = "FINISHED"
    match.winner_id = winner_id
    match.finished_at = datetime.now(timezone.utc)
    # Mark queue entries as DONE so players are never redirected back into a finished match.
    db.query(MatchQueue).filter(MatchQueue.match_id == match.id).update({"status": "DONE"})
    for uid in (match.player1_id, match.player2_id):
        gm.record_activity(db, uid)
        xp = XP_MP_DRAW if winner_id is None else (XP_MP_WIN if uid == winner_id else XP_MP_PLAY)
        gm.add_xp(db, uid, xp)
        stats = gm.get_or_create_stats(db, uid)
        stats.games_played += 1
        if winner_id is None:
            stats.draws += 1
        elif uid == winner_id:
            stats.wins += 1
        else:
            stats.losses += 1
        check_achievements(db, uid, couple_streak=gm.couple_streak(db, uid)["days"])


def apply_hangman_guess(db: Session, match: MultiplayerMatch, user_id: str, letter: str) -> dict:
    letter = letter.strip().lower()
    if len(letter) != 1 or not letter.isalpha() or not letter.isascii():
        raise ValueError("Digite apenas uma letra (A-Z).")

    st = dict(match.state)
    rounds = list(st["rounds"])
    idx = st["round_index"]
    if idx >= len(rounds):
        return st

    rnd = dict(rounds[idx])
    is_p1 = user_id == match.player1_id
    g_key = "p1_guessed" if is_p1 else "p2_guessed"
    w_key = "p1_wrong" if is_p1 else "p2_wrong"
    s_key = "p1_status" if is_p1 else "p2_status"

    if rnd[s_key] != "PLAYING":
        return st

    guessed = list(rnd[g_key])
    if letter in guessed:
        return st
    guessed.append(letter)
    rnd[g_key] = guessed

    word = rnd["word"]
    if letter not in word:
        rnd[w_key] = rnd[w_key] + 1

    if all(ch in guessed for ch in word):
        rnd[s_key] = "WON"
    elif rnd[w_key] >= HANGMAN_MAX_ERRORS:
        rnd[s_key] = "LOST"

    round_over = False
    if rnd[s_key] == "WON":
        rnd["winner_id"] = user_id
        if is_p1:
            st["p1_score"] += 1
        else:
            st["p2_score"] += 1
        round_over = True
    elif rnd["p1_status"] == "LOST" and rnd["p2_status"] == "LOST":
        round_over = True

    rounds[idx] = rnd
    st["rounds"] = rounds

    if round_over:
        match_won = st["p1_score"] >= HANGMAN_WIN_SCORE or st["p2_score"] >= HANGMAN_WIN_SCORE
        if match_won or idx + 1 >= len(rounds):
            match.state = st
            if st["p1_score"] > st["p2_score"]:
                winner = match.player1_id
            elif st["p2_score"] > st["p1_score"]:
                winner = match.player2_id
            else:
                winner = None
            _finalize_match(db, match, winner)
            return st
        st["round_index"] = idx + 1

    match.state = st
    return st


def apply_scramble_guess(db: Session, match: MultiplayerMatch, user_id: str, guess: str) -> Tuple[dict, bool]:
    guess = guess.strip().lower()
    st = dict(match.state)
    idx = st["round_index"]
    rounds = list(st["rounds"])
    if idx >= len(rounds):
        return st, False

    current = dict(rounds[idx])
    if guess != current["word"]:
        return st, False

    current["winner_id"] = user_id
    rounds[idx] = current
    st["rounds"] = rounds
    if user_id == match.player1_id:
        st["p1_score"] += 1
    else:
        st["p2_score"] += 1

    if idx + 1 >= len(rounds):
        match.state = st
        if st["p1_score"] > st["p2_score"]:
            winner = match.player1_id
        elif st["p2_score"] > st["p1_score"]:
            winner = match.player2_id
        else:
            winner = None
        _finalize_match(db, match, winner)
    else:
        st["round_index"] = idx + 1
        match.state = st

    return st, True


def public_match_state(match: MultiplayerMatch, me_id: str, opponent_name: str) -> dict:
    """Builds a safe view of the match (never leaks the secret word while still playing)."""
    st = match.state
    is_p1 = me_id == match.player1_id
    finished = match.status != "ACTIVE"

    base = {
        "id": match.id,
        "game_type": match.game_type,
        "status": match.status,
        "opponent_name": opponent_name,
        "is_p1": is_p1,
        "winner_id": match.winner_id,
        "i_won": finished and match.winner_id == me_id,
        "is_draw": match.status == "FINISHED" and match.winner_id is None,
    }

    rounds = st["rounds"]
    idx = min(st["round_index"], len(rounds) - 1)
    cur = rounds[idx]

    if match.game_type == "HANGMAN":
        word = cur["word"]
        my_g = cur["p1_guessed"] if is_p1 else cur["p2_guessed"]
        opp_g = cur["p2_guessed"] if is_p1 else cur["p1_guessed"]
        prev = rounds[idx - 1] if idx > 0 else None
        base["hangman"] = {
            "round_index": idx,
            "total_rounds": len(rounds),
            "win_score": HANGMAN_WIN_SCORE,
            "my_score": st["p1_score"] if is_p1 else st["p2_score"],
            "opp_score": st["p2_score"] if is_p1 else st["p1_score"],
            "length": len(word),
            "hint": cur["hint"],
            "max_errors": HANGMAN_MAX_ERRORS,
            "my_mask": [ch if (ch in my_g or finished) else "_" for ch in word],
            "opp_revealed_count": sum(1 for ch in word if ch in opp_g),
            "my_guessed": my_g,
            "my_wrong": cur["p1_wrong"] if is_p1 else cur["p2_wrong"],
            "opp_wrong": cur["p2_wrong"] if is_p1 else cur["p1_wrong"],
            "my_status": cur["p1_status"] if is_p1 else cur["p2_status"],
            "opp_status": cur["p2_status"] if is_p1 else cur["p1_status"],
            "word": word if finished else None,
            "last_word": prev["word"] if prev else None,
            "last_hint": prev["hint"] if prev else None,
            "last_won_by_me": (prev["winner_id"] == me_id) if prev and prev["winner_id"] else None,
        }
    else:
        base["scramble"] = {
            "round_index": idx,
            "total_rounds": len(rounds),
            "scrambled": cur["scrambled"],
            "hint": cur["hint"],
            "word_length": len(cur["word"]),
            "my_score": st["p1_score"] if is_p1 else st["p2_score"],
            "opp_score": st["p2_score"] if is_p1 else st["p1_score"],
            "last_word": rounds[idx - 1]["word"] if idx > 0 else (cur["word"] if finished else None),
        }
    return base
