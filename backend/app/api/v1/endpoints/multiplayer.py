from typing import Any, Literal
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from jose import jwt, JWTError
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.v1.endpoints.games import _name
from app.core.config import settings
from app.core.database import get_db
from app.models.game import MatchQueue, MultiplayerMatch
from app.models.user import User
from app.services import live
from app.services import multiplayer as mp

router = APIRouter()


class QueueJoin(BaseModel):
    game_type: Literal["HANGMAN", "SCRAMBLE"]


class HangmanMove(BaseModel):
    letter: str


class ScrambleMove(BaseModel):
    guess: str


def _queue_notify(user_id: str) -> None:
    live.notify(f"queue:{user_id}")


def _match_notify(match_id: str) -> None:
    live.notify(f"match:{match_id}")


# ---------- Matchmaking Queue ----------
@router.get("/queue/status")
def queue_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Any:
    my_entry = (
        db.query(MatchQueue)
        .filter(MatchQueue.user_id == current_user.id, MatchQueue.status.in_(["WAITING", "MATCHED"]))
        .order_by(MatchQueue.created_at.desc())
        .first()
    )
    # Count how many OTHER players are waiting per game_type so the UI can show "1 waiting!"
    waiting_others = (
        db.query(MatchQueue)
        .filter(MatchQueue.status == "WAITING", MatchQueue.user_id != current_user.id)
        .all()
    )
    waiting_by_game = {}
    for w in waiting_others:
        waiting_by_game[w.game_type] = waiting_by_game.get(w.game_type, 0) + 1

    # Also check if I already have an active multiplayer match
    active_match = (
        db.query(MultiplayerMatch)
        .filter(
            or_(MultiplayerMatch.player1_id == current_user.id, MultiplayerMatch.player2_id == current_user.id),
            MultiplayerMatch.status == "ACTIVE",
        )
        .order_by(MultiplayerMatch.created_at.desc())
        .first()
    )

    return {
        "my_status": my_entry.status if my_entry else "IDLE",
        "my_game_type": my_entry.game_type if my_entry else None,
        "match_id": (my_entry.match_id if my_entry and my_entry.status == "MATCHED" else None) or (active_match.id if active_match else None),
        "waiting_by_game": waiting_by_game,
    }


@router.post("/queue/join")
def queue_join(
    payload: QueueJoin,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    # Cancel any previous waiting entries of this user
    db.query(MatchQueue).filter(
        MatchQueue.user_id == current_user.id,
        MatchQueue.status == "WAITING",
    ).update({"status": "CANCELLED"})

    # Look for another waiting player for the same game_type (lock row on Postgres)
    opponent_entry = (
        db.query(MatchQueue)
        .filter(
            MatchQueue.game_type == payload.game_type,
            MatchQueue.status == "WAITING",
            MatchQueue.user_id != current_user.id,
        )
        .order_by(MatchQueue.created_at.asc())
        .with_for_update()
        .first()
    )

    if opponent_entry:
        state = mp.init_match_state(db, payload.game_type, opponent_entry.user_id, current_user.id)
        match = MultiplayerMatch(
            game_type=payload.game_type,
            player1_id=opponent_entry.user_id,
            player2_id=current_user.id,
            status="ACTIVE",
            state=state,
        )
        db.add(match)
        db.flush()

        opponent_entry.status = "MATCHED"
        opponent_entry.match_id = match.id

        my_entry = MatchQueue(
            user_id=current_user.id,
            game_type=payload.game_type,
            status="MATCHED",
            match_id=match.id,
        )
        db.add(my_entry)
        db.commit()

        _queue_notify(opponent_entry.user_id)
        return {"matched": True, "match_id": match.id, "game_type": payload.game_type}

    entry = MatchQueue(user_id=current_user.id, game_type=payload.game_type, status="WAITING")
    db.add(entry)
    db.commit()
    return {"matched": False, "match_id": None, "game_type": payload.game_type}


@router.post("/queue/leave")
def queue_leave(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Any:
    db.query(MatchQueue).filter(
        MatchQueue.user_id == current_user.id,
        MatchQueue.status == "WAITING",
    ).update({"status": "CANCELLED"})
    db.commit()
    return {"ok": True}


@router.websocket("/ws/queue")
async def queue_socket(websocket: WebSocket, token: str = "", db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user = db.query(User).filter(User.id == payload.get("sub")).first()
    except (JWTError, Exception):
        user = None
    if not user:
        await websocket.close(code=4401)
        return
    room = f"queue:{user.id}"
    await websocket.accept()
    await live.manager.join(room, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        live.manager.leave(room, websocket)


# ---------- Multiplayer Match Room ----------
def _load_match(db: Session, match_id: str, user: User) -> MultiplayerMatch:
    m = db.query(MultiplayerMatch).filter(MultiplayerMatch.id == match_id).with_for_update().first()
    if not m or user.id not in (m.player1_id, m.player2_id):
        raise HTTPException(status_code=404, detail="Partida não encontrada.")
    return m


def _view(db: Session, m: MultiplayerMatch, me: User) -> dict:
    other_id = m.player2_id if m.player1_id == me.id else m.player1_id
    other = db.query(User).filter(User.id == other_id).first()
    return mp.public_match_state(m, me.id, _name(other))


@router.get("/matches/{match_id}")
def get_match(match_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Any:
    m = _load_match(db, match_id, current_user)
    return _view(db, m, current_user)


@router.post("/matches/{match_id}/hangman")
def hangman_move(
    match_id: str,
    payload: HangmanMove,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    m = _load_match(db, match_id, current_user)
    if m.game_type != "HANGMAN" or m.status != "ACTIVE":
        raise HTTPException(status_code=409, detail="Partida já encerrada.")
    try:
        mp.apply_hangman_guess(db, m, current_user.id, payload.letter)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    db.refresh(m)
    _match_notify(match_id)
    return _view(db, m, current_user)


@router.post("/matches/{match_id}/scramble")
def scramble_move(
    match_id: str,
    payload: ScrambleMove,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    m = _load_match(db, match_id, current_user)
    if m.game_type != "SCRAMBLE" or m.status != "ACTIVE":
        raise HTTPException(status_code=409, detail="Partida já encerrada.")
    _, hit = mp.apply_scramble_guess(db, m, current_user.id, payload.guess)
    db.commit()
    db.refresh(m)
    if hit:
        _match_notify(match_id)
    view = _view(db, m, current_user)
    view["hit"] = hit
    return view


@router.post("/matches/{match_id}/cancel")
def cancel_match(match_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Any:
    m = _load_match(db, match_id, current_user)
    if m.status == "ACTIVE":
        m.status = "CANCELLED"
        db.commit()
        _match_notify(match_id)
    # Clear matched queue entry so players can queue again cleanly
    db.query(MatchQueue).filter(MatchQueue.match_id == match_id).update({"status": "CANCELLED"})
    db.commit()
    return {"ok": True}


@router.websocket("/ws/matches/{match_id}")
async def match_socket(websocket: WebSocket, match_id: str, token: str = "", db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user = db.query(User).filter(User.id == payload.get("sub")).first()
        m = db.query(MultiplayerMatch).filter(MultiplayerMatch.id == match_id).first()
        allowed = bool(user and m and user.id in (m.player1_id, m.player2_id))
    except (JWTError, Exception):
        allowed = False
    if not allowed:
        await websocket.close(code=4401)
        return
    room = f"match:{match_id}"
    await websocket.accept()
    await live.manager.join(room, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        live.manager.leave(room, websocket)
