from typing import Any, List, Literal, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.game import GameStats, Duel, UserAchievement, WordleGame, WeeklyScore, WeeklyBet, MatchQueue, MultiplayerMatch
from app.services import gamification as gm
from app.services import wordle as wd
from app.services.achievements import CATALOG, check_achievements

router = APIRouter()


# ---------- Schemas ----------
class DuelCreate(BaseModel):
    opponent_id: str
    num_questions: int = Field(default=10, ge=3, le=gm.MAX_QUESTIONS)
    game_type: Literal["VOCAB", "CLOZE"] = "VOCAB"
    mode: Literal["ASYNC", "LIVE"] = "ASYNC"


class AnswerSubmit(BaseModel):
    question_index: int = Field(ge=0)
    choice: int = Field(ge=0)
    time_ms: int = Field(default=0, ge=0, le=600000)


class WordleGuess(BaseModel):
    guess: str
    # Number of guesses this device currently sees. Lets the server detect a stale device.
    expected_attempt: int = Field(ge=0)


class WeeklyBetUpdate(BaseModel):
    stake: str = Field(max_length=120)


def _name(user: Optional[User]) -> str:
    if not user:
        return "?"
    return user.full_name or user.email.split("@")[0]


def _stats_dict(user: User, stats: Optional[GameStats]) -> dict:
    xp = stats.xp if stats else 0
    level = gm.level_for_xp(xp)
    return {
        "user_id": user.id,
        "name": _name(user),
        "xp": xp,
        "level": level,
        "level_floor_xp": gm.xp_for_level(level),
        "next_level_xp": gm.xp_for_level(level + 1),
        "games_played": stats.games_played if stats else 0,
        "wins": stats.wins if stats else 0,
        "losses": stats.losses if stats else 0,
        "draws": stats.draws if stats else 0,
        "streak_days": user.profile.current_streak if user.profile else 0,
    }


def _duel_summary(db: Session, duel: Duel, me: User) -> dict:
    is_challenger = duel.challenger_id == me.id
    other_id = duel.opponent_id if is_challenger else duel.challenger_id
    other = db.query(User).filter(User.id == other_id).first()
    my_answers = duel.challenger_answers if is_challenger else duel.opponent_answers
    other_answers = duel.opponent_answers if is_challenger else duel.challenger_answers
    total = len(duel.questions)
    finished = duel.status == "FINISHED"
    return {
        "id": duel.id,
        "status": duel.status,
        "game_type": duel.game_type or "VOCAB",
        "mode": duel.mode or "ASYNC",
        "live_phase": duel.live_phase if duel.status == "ACTIVE" else None,
        "opponent_id": other_id,
        "opponent_name": _name(other),
        "total_questions": total,
        "my_answered": len(my_answers or []),
        "opponent_answered": len(other_answers or []),
        "my_turn_pending": len(my_answers or []) < total,
        "my_score": gm.score(my_answers),
        # opponent's score stays hidden until the duel is over
        "opponent_score": gm.score(other_answers) if finished else None,
        "winner_id": duel.winner_id,
        "i_won": finished and duel.winner_id == me.id,
        "is_draw": finished and duel.winner_id is None,
        "created_at": duel.created_at.isoformat() if duel.created_at else None,
    }


def _get_duel_for(db: Session, duel_id: str, user: User) -> Duel:
    duel = db.query(Duel).filter(Duel.id == duel_id).first()
    if not duel or user.id not in (duel.challenger_id, duel.opponent_id):
        raise HTTPException(status_code=404, detail="Duelo não encontrado.")
    return duel


# ---------- Stats / ranking ----------
@router.get("/stats")
def my_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Any:
    stats = db.query(GameStats).filter(GameStats.user_id == current_user.id).first()
    data = _stats_dict(current_user, stats)
    data["couple_streak"] = gm.couple_streak(db, current_user.id)
    return data


@router.get("/leaderboard")
def leaderboard(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Any:
    users = db.query(User).filter(User.is_active == True).all()  # noqa: E712
    stats_map = {s.user_id: s for s in db.query(GameStats).all()}
    rows = [_stats_dict(u, stats_map.get(u.id)) for u in users]
    rows.sort(key=lambda r: (-r["xp"], -r["wins"], r["name"].lower()))
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
        r["is_me"] = r["user_id"] == current_user.id
    return rows[:50]


@router.get("/players")
def players(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Any:
    users = db.query(User).filter(User.is_active == True, User.id != current_user.id).all()  # noqa: E712
    return [{"id": u.id, "name": _name(u)} for u in users]


# ---------- Duels ----------
@router.post("/duels", status_code=201)
def create_duel(
    payload: DuelCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    if payload.opponent_id == current_user.id:
        raise HTTPException(status_code=400, detail="Você não pode desafiar a si mesmo.")
    opponent = db.query(User).filter(User.id == payload.opponent_id, User.is_active == True).first()  # noqa: E712
    if not opponent:
        raise HTTPException(status_code=404, detail="Oponente não encontrado.")
    try:
        questions = gm.BUILDERS[payload.game_type](db, [current_user.id, opponent.id], payload.num_questions)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    duel = Duel(
        challenger_id=current_user.id,
        opponent_id=opponent.id,
        game_type=payload.game_type,
        mode=payload.mode,
        live_phase="LOBBY" if payload.mode == "LIVE" else None,
        live_index=0,
        questions=questions,
        challenger_answers=[],
        opponent_answers=[],
    )
    db.add(duel)
    db.commit()
    db.refresh(duel)
    return _duel_summary(db, duel, current_user)


@router.get("/duels")
def list_duels(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Any:
    duels = (
        db.query(Duel)
        .filter(
            or_(Duel.challenger_id == current_user.id, Duel.opponent_id == current_user.id),
            Duel.status != "CANCELLED",
        )
        .order_by(Duel.created_at.desc())
        .limit(30)
        .all()
    )
    return [_duel_summary(db, d, current_user) for d in duels]


@router.delete("/duels/{duel_id}")
def cancel_duel(duel_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Any:
    duel = _get_duel_for(db, duel_id, current_user)
    if duel.status != "ACTIVE":
        raise HTTPException(status_code=400, detail="Apenas duelos ativos podem ser cancelados.")
    if duel.mode != "LIVE" and (duel.challenger_answers or duel.opponent_answers):
        raise HTTPException(status_code=400, detail="Não é possível cancelar um duelo que já foi respondido.")
    duel.status = "CANCELLED"
    duel.live_phase = None
    db.commit()
    if duel.mode == "LIVE":
        from app.services import live as lv
        lv.notify(duel_id)
    return {"ok": True}


@router.get("/duels/{duel_id}")
def get_duel(duel_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Any:
    duel = _get_duel_for(db, duel_id, current_user)
    summary = _duel_summary(db, duel, current_user)
    is_challenger = duel.challenger_id == current_user.id
    my_answers = duel.challenger_answers if is_challenger else duel.opponent_answers
    # Correct answers are only exposed for questions I already answered.
    summary["questions"] = [
        {"text": q["text"], "options": q["options"], "hint": q.get("hint")} for q in duel.questions
    ]
    summary["my_answers"] = [
        {"choice": a["choice"], "correct": a["correct"], "correct_index": duel.questions[i]["correct"]}
        for i, a in enumerate(my_answers or [])
    ]
    return summary


@router.post("/duels/{duel_id}/answer")
def answer(
    duel_id: str,
    payload: AnswerSubmit,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    duel = _get_duel_for(db, duel_id, current_user)
    if duel.mode == "LIVE":
        raise HTTPException(status_code=400, detail="Duelos ao vivo são respondidos na sala ao vivo.")
    is_challenger = duel.challenger_id == current_user.id
    my_answers = list((duel.challenger_answers if is_challenger else duel.opponent_answers) or [])
    total = len(duel.questions)

    if payload.question_index >= total:
        raise HTTPException(status_code=400, detail="Pergunta inválida.")
    question = duel.questions[payload.question_index]

    # Idempotent: if this question was already answered (from another device, or a
    # retried request) return the recorded result instead of failing or double counting.
    if payload.question_index < len(my_answers):
        prev = my_answers[payload.question_index]
        return {
            "correct": prev["correct"],
            "correct_index": question["correct"],
            "finished_me": len(my_answers) >= total,
            "already_answered": True,
            "duel": _duel_summary(db, duel, current_user),
        }
    if payload.question_index != len(my_answers):
        raise HTTPException(status_code=409, detail="Pergunta fora de ordem. Sincronize o duelo.")
    if payload.choice >= len(question["options"]):
        raise HTTPException(status_code=400, detail="Opção inválida.")

    correct = payload.choice == question["correct"]
    my_answers.append({"choice": payload.choice, "correct": correct, "time_ms": payload.time_ms})
    if is_challenger:
        duel.challenger_answers = my_answers
    else:
        duel.opponent_answers = my_answers

    gm.record_activity(db, current_user.id)
    done = len(my_answers) >= total
    if done and len(duel.challenger_answers or []) >= total and len(duel.opponent_answers or []) >= total:
        gm.finalize_duel(db, duel)

    db.commit()
    db.refresh(duel)
    return {
        "correct": correct,
        "correct_index": question["correct"],
        "finished_me": done,
        "already_answered": False,
        "duel": _duel_summary(db, duel, current_user),
    }


# ---------- Achievements ----------
@router.get("/achievements")
def achievements(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Any:
    # Re-evaluate so progress made outside games (e.g. reviews) is picked up.
    check_achievements(db, current_user.id, couple_streak=gm.couple_streak(db, current_user.id)["days"])
    db.commit()
    mine = {a.code: a for a in db.query(UserAchievement).filter(UserAchievement.user_id == current_user.id).all()}
    out = []
    for code, (icon, name, desc) in CATALOG.items():
        a = mine.get(code)
        out.append({
            "code": code, "icon": icon, "name": name, "description": desc,
            "unlocked": a is not None,
            "seen": bool(a.seen) if a else True,
            "unlocked_at": a.unlocked_at.isoformat() if a and a.unlocked_at else None,
        })
    return out


@router.post("/achievements/seen")
def mark_achievements_seen(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Any:
    db.query(UserAchievement).filter(
        UserAchievement.user_id == current_user.id, UserAchievement.seen == False  # noqa: E712
    ).update({"seen": True})
    db.commit()
    return {"ok": True}


# ---------- Wordle (palavra do dia) ----------
def _wordle_row(db: Session, user_id: str, day: str, create: bool = False) -> Optional[WordleGame]:
    row = db.query(WordleGame).filter(WordleGame.user_id == user_id, WordleGame.day == day).first()
    if not row and create:
        row = WordleGame(user_id=user_id, day=day, guesses=[], status="IN_PROGRESS")
        db.add(row)
        db.flush()
    return row


def _wordle_state(db: Session, user: User, day: str) -> dict:
    target = wd.target_word(day)
    row = _wordle_row(db, user.id, day)
    guesses = list(row.guesses or []) if row else []
    status = row.status if row else "IN_PROGRESS"
    finished = status != "IN_PROGRESS"

    others = []
    for u in db.query(User).filter(User.id != user.id, User.is_active == True).all():  # noqa: E712
        o = _wordle_row(db, u.id, day)
        entry = {"name": _name(u), "played": bool(o and o.guesses), "finished": bool(o and o.status != "IN_PROGRESS")}
        # Opponent's result is only revealed once I'm done, so nobody can peek.
        if finished and o and o.status != "IN_PROGRESS":
            entry["won"] = o.status == "WON"
            entry["attempts"] = len(o.guesses)
        others.append(entry)

    return {
        "day": day,
        "status": status,
        "max_guesses": wd.MAX_GUESSES,
        "word_length": wd.WORD_LENGTH,
        "guesses": [{"word": g, "result": wd.evaluate(g, target)} for g in guesses],
        "answer": target if finished else None,
        "others": others,
    }


@router.get("/wordle/today")
def wordle_today(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Any:
    return _wordle_state(db, current_user, gm.today_str())


@router.post("/wordle/guess")
def wordle_guess(
    payload: WordleGuess,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    day = gm.today_str()
    guess = payload.guess.strip().lower()
    if len(guess) != wd.WORD_LENGTH or not guess.isalpha() or not guess.isascii():
        raise HTTPException(status_code=400, detail=f"Digite uma palavra de {wd.WORD_LENGTH} letras.")

    row = _wordle_row(db, current_user.id, day, create=True)
    guesses = list(row.guesses or [])
    if row.status != "IN_PROGRESS":
        raise HTTPException(status_code=409, detail="A palavra de hoje já foi concluída. Sincronize.")
    if payload.expected_attempt != len(guesses):
        raise HTTPException(status_code=409, detail="Seu jogo mudou em outro aparelho. Sincronize.")

    target = wd.target_word(day)
    guesses.append(guess)
    row.guesses = guesses
    won = guess == target
    if won:
        row.status = "WON"
    elif len(guesses) >= wd.MAX_GUESSES:
        row.status = "LOST"

    gm.record_activity(db, current_user.id)
    new_achievements: List[str] = []
    if row.status != "IN_PROGRESS":
        from datetime import datetime, timezone
        row.finished_at = datetime.now(timezone.utc)
        gm.add_xp(db, current_user.id, wd.xp_for_result(won, len(guesses)))
        extra = {"wordle_fast"} if won and len(guesses) <= 3 else set()
        new_achievements = check_achievements(
            db, current_user.id, extra=extra, couple_streak=gm.couple_streak(db, current_user.id)["days"]
        )
    db.commit()

    state = _wordle_state(db, current_user, day)
    state["new_achievements"] = new_achievements
    return state



# ---------- Pending notifications (for BottomNav badge) ----------
@router.get("/pending-count")
def pending_count(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Any:
    active_duels = (
        db.query(Duel)
        .filter(
            or_(Duel.challenger_id == current_user.id, Duel.opponent_id == current_user.id),
            Duel.status == "ACTIVE",
        )
        .all()
    )
    live_invites = 0
    my_turn_duels = 0
    for d in active_duels:
        if d.mode == "LIVE":
            if d.opponent_id == current_user.id or d.live_phase in ("QUESTION", "REVEAL"):
                live_invites += 1
        else:
            is_c = d.challenger_id == current_user.id
            mine = d.challenger_answers if is_c else d.opponent_answers
            if len(mine or []) < len(d.questions):
                my_turn_duels += 1

    unseen = (
        db.query(UserAchievement)
        .filter(UserAchievement.user_id == current_user.id, UserAchievement.seen == False)  # noqa: E712
        .count()
    )
    queue_waiting = (
        db.query(MatchQueue)
        .filter(MatchQueue.status == "WAITING", MatchQueue.user_id != current_user.id)
        .count()
    )
    active_mp = (
        db.query(MultiplayerMatch)
        .filter(
            or_(MultiplayerMatch.player1_id == current_user.id, MultiplayerMatch.player2_id == current_user.id),
            MultiplayerMatch.status == "ACTIVE",
        )
        .count()
    )
    return {
        "count": live_invites + my_turn_duels + unseen + queue_waiting + active_mp,
        "live_invites": live_invites,
        "my_turn_duels": my_turn_duels,
        "unseen_achievements": unseen,
    }


# ---------- Weekly leaderboard & couple bet ----------
def _weekly_payload(db: Session, current_user: User) -> dict:
    wk = gm.week_key_str()
    prev_wk = gm.week_key_str(-1)
    users = db.query(User).filter(User.is_active == True).all()  # noqa: E712
    users_by_id = {u.id: u for u in users}

    scores = {s.user_id: s for s in db.query(WeeklyScore).filter(WeeklyScore.week_key == wk).all()}
    rows = []
    for u in users:
        s = scores.get(u.id)
        rows.append({
            "user_id": u.id,
            "name": _name(u),
            "weekly_xp": s.xp if s else 0,
            "weekly_wins": s.wins if s else 0,
            "is_me": u.id == current_user.id,
        })
    rows.sort(key=lambda r: (-r["weekly_xp"], -r["weekly_wins"], r["name"].lower()))
    for i, r in enumerate(rows, start=1):
        r["rank"] = i

    bet = db.query(WeeklyBet).filter(WeeklyBet.week_key == wk).first()
    updater = users_by_id.get(bet.updated_by) if bet and bet.updated_by else None

    prev_scores = db.query(WeeklyScore).filter(WeeklyScore.week_key == prev_wk, WeeklyScore.xp > 0).all()
    prev_bet = db.query(WeeklyBet).filter(WeeklyBet.week_key == prev_wk).first()
    last_week_winner = None
    if prev_scores:
        top = max(prev_scores, key=lambda s: (s.xp, s.wins))
        winner_user = users_by_id.get(top.user_id)
        if winner_user:
            last_week_winner = {
                "name": _name(winner_user),
                "xp": top.xp,
                "wins": top.wins,
                "stake": prev_bet.stake if prev_bet else "",
            }

    return {
        "week_key": wk,
        "stake": bet.stake if bet else "",
        "stake_updated_by_name": _name(updater) if updater else None,
        "rows": rows[:50],
        "last_week_winner": last_week_winner,
    }


@router.get("/weekly")
def weekly_leaderboard(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Any:
    return _weekly_payload(db, current_user)


@router.put("/weekly/bet")
def update_weekly_bet(
    payload: WeeklyBetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    from datetime import datetime, timezone
    wk = gm.week_key_str()
    stake = payload.stake.strip()
    bet = db.query(WeeklyBet).filter(WeeklyBet.week_key == wk).first()
    if not bet:
        bet = WeeklyBet(week_key=wk, stake=stake, updated_by=current_user.id, updated_at=datetime.now(timezone.utc))
        db.add(bet)
    else:
        bet.stake = stake
        bet.updated_by = current_user.id
        bet.updated_at = datetime.now(timezone.utc)
    db.commit()
    return _weekly_payload(db, current_user)
