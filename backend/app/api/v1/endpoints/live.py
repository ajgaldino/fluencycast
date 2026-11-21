from typing import Any
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from jose import jwt, JWTError
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.v1.endpoints.games import _name
from app.core.config import settings
from app.core.database import get_db
from app.models.game import Duel
from app.models.user import User
from app.services import gamification as gm
from app.services import live

router = APIRouter()


class LiveAnswer(BaseModel):
    question_index: int = Field(ge=0)
    choice: int = Field(ge=0)


def _load_live_duel(db: Session, duel_id: str, user: User) -> Duel:
    # FOR UPDATE serialises the two players' requests on PostgreSQL (ignored by SQLite).
    duel = db.query(Duel).filter(Duel.id == duel_id).with_for_update().first()
    if not duel or user.id not in (duel.challenger_id, duel.opponent_id) or duel.mode != "LIVE":
        raise HTTPException(status_code=404, detail="Duelo ao vivo não encontrado.")
    return duel


def _state(db: Session, duel: Duel, user: User) -> dict:
    other_id = duel.opponent_id if duel.challenger_id == user.id else duel.challenger_id
    other = db.query(User).filter(User.id == other_id).first()
    return live.build_state(duel, user.id, _name(other))


@router.get("/duels/{duel_id}/live")
def live_state(duel_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Any:
    duel = _load_live_duel(db, duel_id, current_user)
    changed = live.advance(db, duel)
    if changed:
        db.commit()
        live.notify(duel_id)
    return _state(db, duel, current_user)


@router.post("/duels/{duel_id}/live/join")
def live_join(duel_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> Any:
    """The invited player enters the room; the first question starts for both."""
    duel = _load_live_duel(db, duel_id, current_user)
    if duel.status == "ACTIVE" and duel.live_phase == "LOBBY":
        if current_user.id != duel.opponent_id:
            raise HTTPException(status_code=400, detail="Aguarde seu oponente entrar na sala.")
        duel.live_phase = "QUESTION"
        duel.live_index = 0
        duel.phase_started_at = live.utcnow()
        gm.record_activity(db, current_user.id)
        db.commit()
        live.notify(duel_id)
    return _state(db, duel, current_user)


@router.post("/duels/{duel_id}/live/answer")
def live_answer(
    duel_id: str,
    payload: LiveAnswer,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    duel = _load_live_duel(db, duel_id, current_user)
    live.advance(db, duel)  # settle anything overdue before judging this answer

    if duel.status != "ACTIVE" or duel.live_phase != "QUESTION":
        db.commit()
        raise HTTPException(status_code=409, detail="Essa rodada já terminou.")
    if payload.question_index != duel.live_index:
        db.commit()
        raise HTTPException(status_code=409, detail="Pergunta fora de sincronia.")

    is_c = duel.challenger_id == current_user.id
    mine = live._answers(duel, is_c)
    if len(mine) > duel.live_index:
        return _state(db, duel, current_user)  # idempotent retry / second device

    question = duel.questions[duel.live_index]
    if payload.choice >= len(question["options"]):
        raise HTTPException(status_code=400, detail="Opção inválida.")

    # Response time is measured by the server: nobody can fake a faster answer.
    mine.append({
        "choice": payload.choice,
        "correct": payload.choice == question["correct"],
        "time_ms": min(live.elapsed_ms(duel), live.QUESTION_SECONDS * 1000),
    })
    live._set_answers(duel, is_c, mine)
    gm.record_activity(db, current_user.id)
    live.advance(db, duel)  # both answered -> straight to REVEAL
    db.commit()
    live.notify(duel_id)
    return _state(db, duel, current_user)


@router.websocket("/ws/duels/{duel_id}")
async def duel_socket(websocket: WebSocket, duel_id: str, token: str = "", db: Session = Depends(get_db)):
    """Push channel: tells connected players to refetch state. Carries no game data."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user = db.query(User).filter(User.id == payload.get("sub")).first()
        duel = db.query(Duel).filter(Duel.id == duel_id).first()
        allowed = bool(user and duel and user.id in (duel.challenger_id, duel.opponent_id))
    except (JWTError, Exception):
        allowed = False
    if not allowed:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    await live.manager.join(duel_id, websocket)
    try:
        while True:
            await websocket.receive_text()  # keep-alive pings from the client
    except WebSocketDisconnect:
        pass
    finally:
        live.manager.leave(duel_id, websocket)
