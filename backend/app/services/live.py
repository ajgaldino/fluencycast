"""Live (real-time) duel engine.

The state machine is driven lazily by the server and stored in the database:

    LOBBY --(opponent joins)--> QUESTION --(both answered | timeout)--> REVEAL
      ^                            ^                                      |
      |                            +----------(reveal time elapsed)-------+
      +-- (after last REVEAL) --> duel FINISHED

Any request calls `advance()` which makes the transitions that are due, so no
background worker is needed and a server restart loses nothing. WebSockets are
only a "something changed, refetch" notification layer on top of this; polling
keeps working if the socket is unavailable.
"""
from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, Optional, Set

from fastapi import WebSocket

from app.models.game import Duel
from app.services import gamification as gm

QUESTION_SECONDS = 15
REVEAL_SECONDS = 3
TIMEOUT_CHOICE = -1


def utcnow() -> datetime:
    # Columns are naive DateTime holding UTC wall time.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def elapsed_ms(duel: Duel) -> int:
    if not duel.phase_started_at:
        return 0
    return max(0, int((utcnow() - duel.phase_started_at).total_seconds() * 1000))


def _answers(duel: Duel, challenger: bool) -> list:
    return list((duel.challenger_answers if challenger else duel.opponent_answers) or [])


def _set_answers(duel: Duel, challenger: bool, value: list) -> None:
    if challenger:
        duel.challenger_answers = value
    else:
        duel.opponent_answers = value


def advance(db, duel: Duel) -> bool:
    """Apply the due transition (if any). Returns True when state changed."""
    if duel.mode != "LIVE" or duel.status != "ACTIVE":
        return False
    idx = duel.live_index
    total = len(duel.questions)

    if duel.live_phase == "QUESTION":
        c, o = _answers(duel, True), _answers(duel, False)
        both = len(c) > idx and len(o) > idx
        timed_out = elapsed_ms(duel) >= QUESTION_SECONDS * 1000
        if not (both or timed_out):
            return False
        # Anyone who didn't answer in time gets a recorded miss (keeps lists index-aligned).
        for is_c, lst in ((True, c), (False, o)):
            if len(lst) <= idx:
                lst.append({"choice": TIMEOUT_CHOICE, "correct": False, "time_ms": QUESTION_SECONDS * 1000})
                _set_answers(duel, is_c, lst)
        duel.live_phase = "REVEAL"
        duel.phase_started_at = utcnow()
        return True

    if duel.live_phase == "REVEAL" and elapsed_ms(duel) >= REVEAL_SECONDS * 1000:
        duel.live_index = idx + 1
        if duel.live_index >= total:
            duel.live_phase = None
            gm.finalize_duel(db, duel)
        else:
            duel.live_phase = "QUESTION"
            duel.phase_started_at = utcnow()
        return True

    return False


def build_state(duel: Duel, me_id: str, opponent_name: str) -> dict:
    is_c = duel.challenger_id == me_id
    mine, theirs = _answers(duel, is_c), _answers(duel, not is_c)
    idx, total = duel.live_index, len(duel.questions)
    finished = duel.status == "FINISHED"
    cancelled = duel.status == "CANCELLED"

    if cancelled:
        phase = "CANCELLED"
    elif finished:
        phase = "FINISHED"
    else:
        phase = duel.live_phase or "LOBBY"

    # Scores only include questions that were already revealed.
    revealed = total if finished else (idx + 1 if phase == "REVEAL" else idx)
    state = {
        "id": duel.id,
        "mode": "LIVE",
        "game_type": duel.game_type,
        "phase": phase,
        "index": min(idx, total - 1),
        "total": total,
        "is_challenger": is_c,
        "opponent_name": opponent_name,
        "question_seconds": QUESTION_SECONDS,
        "reveal_seconds": REVEAL_SECONDS,
        "my_score": gm.score(mine[:revealed]),
        "opponent_score": gm.score(theirs[:revealed]),
        "remaining_ms": 0,
        "question": None,
        "my_answered": False,
        "opponent_answered": False,
        "my_choice": None,
        "reveal": None,
        "winner_id": duel.winner_id,
        "i_won": finished and duel.winner_id == me_id,
        "is_draw": finished and duel.winner_id is None,
    }

    if phase in ("QUESTION", "REVEAL"):
        q = duel.questions[idx]
        state["question"] = {"text": q["text"], "options": q["options"], "hint": q.get("hint")}
        state["my_answered"] = len(mine) > idx
        state["opponent_answered"] = len(theirs) > idx
        if state["my_answered"]:
            state["my_choice"] = mine[idx]["choice"]
        limit = QUESTION_SECONDS if phase == "QUESTION" else REVEAL_SECONDS
        state["remaining_ms"] = max(0, limit * 1000 - elapsed_ms(duel))
        if phase == "REVEAL":
            state["reveal"] = {
                "correct_index": q["correct"],
                "my_choice": mine[idx]["choice"] if len(mine) > idx else TIMEOUT_CHOICE,
                "opponent_choice": theirs[idx]["choice"] if len(theirs) > idx else TIMEOUT_CHOICE,
            }
    return state


class RoomManager:
    """In-memory WebSocket rooms (one per duel). Single-process; polling covers multi-worker."""

    def __init__(self) -> None:
        self.rooms: Dict[str, Set[WebSocket]] = defaultdict(set)

    async def join(self, duel_id: str, ws: WebSocket) -> None:
        self.rooms[duel_id].add(ws)

    def leave(self, duel_id: str, ws: WebSocket) -> None:
        self.rooms[duel_id].discard(ws)
        if not self.rooms[duel_id]:
            self.rooms.pop(duel_id, None)

    async def broadcast(self, duel_id: str, message: Optional[dict] = None) -> None:
        payload = message or {"type": "changed"}
        for ws in list(self.rooms.get(duel_id, ())):
            try:
                await ws.send_json(payload)
            except Exception:
                self.leave(duel_id, ws)


manager = RoomManager()


def notify(duel_id: str) -> None:
    """Fire-and-forget broadcast usable from sync endpoints (threadpool) and tests."""
    try:
        from anyio import from_thread

        from_thread.run(manager.broadcast, duel_id)
    except Exception:
        pass  # no running loop / no sockets: clients fall back to polling
