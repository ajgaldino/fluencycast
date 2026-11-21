import math
import random
import re
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.game import GameStats, Duel, GameActivity, WeeklyScore
from app.models.phrase import SavedPhrase
from app.models.user import User

XP_PER_CORRECT = 10
XP_PARTICIPATION = 5
XP_WIN_BONUS = 20
XP_DRAW_BONUS = 10
XP_PER_REVIEW = 2
MIN_POOL = 4
MIN_CLOZE_SENTENCES = 3
MAX_QUESTIONS = 20

# Every device must agree on "today": the server decides, always in Brasília time.
BRT = timezone(timedelta(hours=-3))


def today_str(offset_days: int = 0) -> str:
    return (datetime.now(BRT) + timedelta(days=offset_days)).strftime("%Y-%m-%d")


def week_key_str(offset_weeks: int = 0) -> str:
    now = datetime.now(BRT) + timedelta(weeks=offset_weeks)
    monday = now - timedelta(days=now.weekday())
    return monday.strftime("%Y-%m-%d")


def level_for_xp(xp: int) -> int:
    return int(math.sqrt(max(xp, 0) / 50)) + 1


def xp_for_level(level: int) -> int:
    return 50 * (level - 1) ** 2


def get_or_create_stats(db: Session, user_id: str) -> GameStats:
    stats = db.query(GameStats).filter(GameStats.user_id == user_id).first()
    if not stats:
        stats = GameStats(user_id=user_id, xp=0, games_played=0, wins=0, losses=0, draws=0)
        db.add(stats)
        db.flush()
    return stats


def get_or_create_weekly(db: Session, user_id: str, week_key: Optional[str] = None) -> WeeklyScore:
    wk = week_key or week_key_str()
    row = db.query(WeeklyScore).filter(WeeklyScore.user_id == user_id, WeeklyScore.week_key == wk).first()
    if not row:
        row = WeeklyScore(user_id=user_id, week_key=wk, xp=0, wins=0)
        db.add(row)
        db.flush()
    return row


def add_xp(db: Session, user_id: str, amount: int) -> None:
    get_or_create_stats(db, user_id).xp += amount
    get_or_create_weekly(db, user_id).xp += amount


def record_activity(db: Session, user_id: str) -> None:
    day = today_str()
    exists = db.query(GameActivity).filter(GameActivity.user_id == user_id, GameActivity.day == day).first()
    if not exists:
        db.add(GameActivity(user_id=user_id, day=day))
        db.flush()


def _days_of(db: Session, user_id: str) -> set:
    return {a.day for a in db.query(GameActivity).filter(GameActivity.user_id == user_id).all()}


def couple_streak(db: Session, user_id: str) -> dict:
    """Longest current run of days on which I AND another player were both active."""
    mine = _days_of(db, user_id)
    best = {"days": 0, "partner_name": None, "today_done": False}
    if not mine:
        return best
    others = db.query(User).filter(User.id != user_id, User.is_active == True).all()  # noqa: E712
    today = today_str()
    for other in others:
        both = mine & _days_of(db, other.id)
        if not both:
            continue
        # If today isn't complete yet, the streak is still alive through yesterday.
        cursor = 0 if today in both else -1
        days = 0
        while today_str(cursor) in both:
            days += 1
            cursor -= 1
        if days > best["days"] or (days == best["days"] and best["partner_name"] is None):
            best = {
                "days": days,
                "partner_name": other.full_name or other.email.split("@")[0],
                "today_done": today in both,
            }
    return best


# ---------------------------------------------------------------- questions
def _saved_with_translation(db: Session, user_ids: List[str]) -> List[SavedPhrase]:
    return (
        db.query(SavedPhrase)
        .filter(SavedPhrase.user_id.in_(user_ids))
        .filter(SavedPhrase.translation.isnot(None))
        .all()
    )


def build_vocab_questions(db: Session, user_ids: List[str], num_questions: int) -> List[dict]:
    """Multiple-choice 'what does X mean?' questions from the users' saved phrases."""
    pool = {}
    for p in _saved_with_translation(db, user_ids):
        text = (p.text or "").strip()
        translation = (p.translation or "").strip()
        if not text or not translation or len(text) > 80 or len(translation) > 80:
            continue
        pool.setdefault(text.lower(), (text, translation))
    items = list(pool.values())
    if len({t for _, t in items}) < MIN_POOL:
        raise ValueError(
            f"São necessárias pelo menos {MIN_POOL} frases/palavras traduzidas salvas "
            "(somando as dos dois jogadores) para iniciar um duelo."
        )

    random.shuffle(items)
    questions = []
    for text, translation in items[: min(num_questions, MAX_QUESTIONS)]:
        others = list({t for _, t in items if t.lower() != translation.lower()})
        distractors = random.sample(others, min(3, len(others)))
        options = distractors + [translation]
        random.shuffle(options)
        questions.append({"text": text, "options": options, "correct": options.index(translation)})
    return questions


_WORD_RE = re.compile(r"[A-Za-z']{4,}")


def build_cloze_questions(db: Session, user_ids: List[str], num_questions: int) -> List[dict]:
    """'Complete the sentence' questions: one word of a saved sentence is blanked out."""
    sentences = {}
    for p in db.query(SavedPhrase).filter(SavedPhrase.user_id.in_(user_ids)).all():
        for candidate in (p.text, p.context_sentence):
            s = (candidate or "").strip()
            if 4 <= len(s.split()) <= 25 and _WORD_RE.search(s):
                hint = p.translation if candidate == p.text else None
                sentences.setdefault(s.lower(), (s, hint))
    if len(sentences) < MIN_CLOZE_SENTENCES:
        raise ValueError(
            f"São necessárias pelo menos {MIN_CLOZE_SENTENCES} frases salvas (com 4+ palavras) "
            "para jogar Complete a Frase."
        )

    vocab = list({w.lower() for s, _ in sentences.values() for w in _WORD_RE.findall(s)})
    if len(vocab) < MIN_POOL:
        raise ValueError("Frases salvas com poucas palavras diferentes para montar as alternativas.")

    items = list(sentences.values())
    random.shuffle(items)
    questions = []
    for sentence, hint in items[: min(num_questions, MAX_QUESTIONS)]:
        target = random.choice(_WORD_RE.findall(sentence))
        blanked = re.sub(rf"\b{re.escape(target)}\b", "_____", sentence, count=1)
        distractors = random.sample([w for w in vocab if w != target.lower()], 3)
        options = distractors + [target.lower()]
        random.shuffle(options)
        q = {"text": blanked, "options": options, "correct": options.index(target.lower())}
        if hint:
            q["hint"] = hint
        questions.append(q)
    return questions


BUILDERS = {"VOCAB": build_vocab_questions, "CLOZE": build_cloze_questions}


def score(answers: Optional[list]) -> int:
    return sum(1 for a in (answers or []) if a.get("correct"))


def total_time(answers: Optional[list]) -> int:
    return sum(int(a.get("time_ms", 0)) for a in (answers or []))


def finalize_duel(db: Session, duel: Duel) -> None:
    """Called once both players have answered every question."""
    from app.services.achievements import check_achievements

    c_score, o_score = score(duel.challenger_answers), score(duel.opponent_answers)
    c_time, o_time = total_time(duel.challenger_answers), total_time(duel.opponent_answers)

    if c_score != o_score:
        winner = duel.challenger_id if c_score > o_score else duel.opponent_id
    elif c_time != o_time:  # tie-break: faster wins
        winner = duel.challenger_id if c_time < o_time else duel.opponent_id
    else:
        winner = None

    duel.winner_id = winner
    duel.status = "FINISHED"
    duel.finished_at = datetime.now(timezone.utc)

    total = len(duel.questions)
    exact_draw = c_score == o_score and c_time == o_time
    for uid, s in ((duel.challenger_id, c_score), (duel.opponent_id, o_score)):
        stats = get_or_create_stats(db, uid)
        stats.games_played += 1
        gained = s * XP_PER_CORRECT + XP_PARTICIPATION
        if exact_draw:
            stats.draws += 1
            gained += XP_DRAW_BONUS
        elif uid == winner:
            stats.wins += 1
            gained += XP_WIN_BONUS
        else:
            stats.losses += 1
        stats.xp += gained
        weekly = get_or_create_weekly(db, uid)
        weekly.xp += gained
        if not exact_draw and uid == winner:
            weekly.wins += 1

        extra = set()
        if s == total:
            extra.add("perfect_duel")
        if duel.game_type == "CLOZE":
            extra.add("cloze_first")
        check_achievements(db, uid, extra=extra, couple_streak=couple_streak(db, uid)["days"])
