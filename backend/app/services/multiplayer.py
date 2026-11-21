"""Multiplayer matchmaking & real-time word games (Hangman & Scramble)."""
import random
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.game import MatchQueue, MultiplayerMatch
from app.models.phrase import SavedPhrase
from app.services import gamification as gm
from app.services.achievements import check_achievements

HANGMAN_MAX_ERRORS = 6
SCRAMBLE_ROUNDS = 5
XP_MP_WIN = 25
XP_MP_DRAW = 15
XP_MP_PLAY = 8

# Built-in fallback words (word, Portuguese hint) so matchmaking always works even with 0 saved phrases.
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


def _word_pool(db: Session, user_ids: List[str]) -> List[Tuple[str, str]]:
    """Combine players' single-word saved phrases with the built-in pool."""
    pool: Dict[str, str] = {w: h for w, h in BUILTIN_WORDS}
    rows = (
        db.query(SavedPhrase)
        .filter(SavedPhrase.user_id.in_(user_ids), SavedPhrase.translation.isnot(None))
        .all()
    )
    for r in rows:
        w = (r.text or "").strip().lower()
        h = (r.translation or "").strip()
        if 4 <= len(w) <= 12 and w.isalpha() and w.isascii() and h:
            pool[w] = h
    return list(pool.items())


def _scramble(word: str) -> str:
    letters = list(word)
    for _ in range(10):
        random.shuffle(letters)
        out = "".join(letters)
        if out != word:
            return out
    return word[::-1]


def init_match_state(db: Session, game_type: str, p1_id: str, p2_id: str) -> dict:
    pool = _word_pool(db, [p1_id, p2_id])
    if game_type == "HANGMAN":
        word, hint = random.choice(pool)
        return {
            "word": word,
            "hint": hint,
            "p1_guessed": [],
            "p2_guessed": [],
            "p1_wrong": 0,
            "p2_wrong": 0,
            "p1_status": "PLAYING",  # PLAYING, WON, LOST
            "p2_status": "PLAYING",
        }
    # SCRAMBLE: best of N rounds
    chosen = random.sample(pool, min(SCRAMBLE_ROUNDS, len(pool)))
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
    is_p1 = user_id == match.player1_id
    g_key = "p1_guessed" if is_p1 else "p2_guessed"
    w_key = "p1_wrong" if is_p1 else "p2_wrong"
    s_key = "p1_status" if is_p1 else "p2_status"

    if st[s_key] != "PLAYING":
        return st

    guessed = list(st[g_key])
    if letter in guessed:
        return st
    guessed.append(letter)
    st[g_key] = guessed

    word = st["word"]
    if letter not in word:
        st[w_key] = st[w_key] + 1

    if all(ch in guessed for ch in word):
        st[s_key] = "WON"
    elif st[w_key] >= HANGMAN_MAX_ERRORS:
        st[s_key] = "LOST"

    match.state = st

    # Check if match should end:
    # - Someone won -> that player wins immediately!
    # - Both lost -> draw.
    if st[s_key] == "WON":
        _finalize_match(db, match, user_id)
    elif st["p1_status"] == "LOST" and st["p2_status"] == "LOST":
        _finalize_match(db, match, None)

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

    # Correct! Whoever got here first wins the round.
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

    if match.game_type == "HANGMAN":
        word = st["word"]
        my_g = st["p1_guessed"] if is_p1 else st["p2_guessed"]
        opp_g = st["p2_guessed"] if is_p1 else st["p1_guessed"]
        base["hangman"] = {
            "length": len(word),
            "hint": st["hint"],
            "max_errors": HANGMAN_MAX_ERRORS,
            "my_mask": [ch if (ch in my_g or finished) else "_" for ch in word],
            "opp_mask": [ch if (ch in opp_g or finished) else ("*" if ch in opp_g else "_") for ch in word],
            "opp_revealed_count": sum(1 for ch in word if ch in opp_g),
            "my_guessed": my_g,
            "my_wrong": st["p1_wrong"] if is_p1 else st["p2_wrong"],
            "opp_wrong": st["p2_wrong"] if is_p1 else st["p1_wrong"],
            "my_status": st["p1_status"] if is_p1 else st["p2_status"],
            "opp_status": st["p2_status"] if is_p1 else st["p1_status"],
            "word": word if finished else None,
        }
    else:
        rounds = st["rounds"]
        idx = min(st["round_index"], len(rounds) - 1)
        cur = rounds[idx]
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
