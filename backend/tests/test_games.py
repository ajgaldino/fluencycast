WORDS = [("apple", "maçã"), ("house", "casa"), ("water", "água"), ("fire", "fogo"), ("tree", "árvore")]


def make_user(client, email):
    client.post("/api/v1/auth/register", json={"email": email, "password": "Password123!", "full_name": email.split("@")[0]})
    token = client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_duel_full_flow(client):
    a = make_user(client, "game_a@fluencycast.com")
    b = make_user(client, "game_b@fluencycast.com")

    # Not enough phrases yet
    players = client.get("/api/v1/games/players", headers=a).json()
    b_id = next(p["id"] for p in players if p["name"] == "game_b")
    res = client.post("/api/v1/games/duels", json={"opponent_id": b_id, "num_questions": 5}, headers=a)
    assert res.status_code == 400

    for text, tr in WORDS:
        r = client.post("/api/v1/phrases/", json={"text": text, "translation": tr, "phrase_type": "WORD"}, headers=a)
        assert r.status_code == 201

    res = client.post("/api/v1/games/duels", json={"opponent_id": b_id, "num_questions": 5}, headers=a)
    assert res.status_code == 201
    duel_id = res.json()["id"]

    detail = client.get(f"/api/v1/games/duels/{duel_id}", headers=b).json()
    assert len(detail["questions"]) == 5
    assert "correct" not in detail["questions"][0]

    def play(headers, always_right):
        last = None
        for i in range(5):
            d = client.get(f"/api/v1/games/duels/{duel_id}", headers=headers).json()
            # Find the right answer by probing is impossible; derive from WORDS instead
            q = d["questions"][i]
            word_map = dict(WORDS)
            right = q["options"].index(word_map[q["text"]])
            choice = right if always_right else (right + 1) % len(q["options"])
            last = client.post(
                f"/api/v1/games/duels/{duel_id}/answer",
                json={"question_index": i, "choice": choice, "time_ms": 1000},
                headers=headers,
            )
            assert last.status_code == 200
            assert last.json()["correct"] is always_right
        return last.json()

    play(a, True)
    # B cannot see A's score until the duel ends
    mid = client.get(f"/api/v1/games/duels/{duel_id}", headers=b).json()
    assert mid["opponent_score"] is None and mid["status"] == "ACTIVE"

    final = play(b, False)["duel"]
    assert final["status"] == "FINISHED"
    assert final["opponent_score"] == 5

    stats_a = client.get("/api/v1/games/stats", headers=a).json()
    stats_b = client.get("/api/v1/games/stats", headers=b).json()
    assert stats_a["wins"] == 1 and stats_a["xp"] == 5 * 10 + 5 + 20
    assert stats_b["losses"] == 1 and stats_b["xp"] == 5

    board = client.get("/api/v1/games/leaderboard", headers=a).json()
    assert board[0]["is_me"] is True


def test_cannot_challenge_self(client):
    a = make_user(client, "game_self@fluencycast.com")
    me = client.get("/api/v1/games/stats", headers=a).json()
    res = client.post("/api/v1/games/duels", json={"opponent_id": me["user_id"]}, headers=a)
    assert res.status_code == 400


# ----------------------------------------------------------------- v2 features
from app.services import gamification as gm
from app.services import wordle as wd

SENTENCES = [
    ("I really love singing in the shower", "Eu amo cantar no chuveiro"),
    ("She walks along the beach every morning", "Ela caminha na praia toda manhã"),
    ("They are building a beautiful house together", "Eles constroem uma casa linda juntos"),
    ("We should practice English every single day", "Devemos praticar inglês todo dia"),
]


def test_cloze_duel_and_idempotent_answer(client):
    a = make_user(client, "cloze_a@fluencycast.com")
    b = make_user(client, "cloze_b@fluencycast.com")
    b_id = next(p["id"] for p in client.get("/api/v1/games/players", headers=a).json() if p["name"] == "cloze_b")

    for text, tr in SENTENCES:
        client.post("/api/v1/phrases/", json={"text": text, "translation": tr, "phrase_type": "SENTENCE"}, headers=a)

    res = client.post("/api/v1/games/duels", json={"opponent_id": b_id, "num_questions": 4, "game_type": "CLOZE"}, headers=a)
    assert res.status_code == 201, res.text
    duel_id = res.json()["id"]
    assert res.json()["game_type"] == "CLOZE"

    detail = client.get(f"/api/v1/games/duels/{duel_id}", headers=a).json()
    q = detail["questions"][0]
    assert "_____" in q["text"] and q["hint"]

    first = client.post(f"/api/v1/games/duels/{duel_id}/answer", json={"question_index": 0, "choice": 0, "time_ms": 500}, headers=a).json()
    # Same answer from a second device / retried request: same result, nothing double counted
    again = client.post(f"/api/v1/games/duels/{duel_id}/answer", json={"question_index": 0, "choice": 1, "time_ms": 900}, headers=a).json()
    assert again["already_answered"] is True
    assert again["correct"] == first["correct"]
    assert again["duel"]["my_answered"] == 1

    # Skipping ahead is rejected so a stale device can't corrupt the order
    skip = client.post(f"/api/v1/games/duels/{duel_id}/answer", json={"question_index": 3, "choice": 0}, headers=a)
    assert skip.status_code == 409

    # Resuming on another device: server state tells where to continue
    resumed = client.get(f"/api/v1/games/duels/{duel_id}", headers=a).json()
    assert resumed["my_answered"] == 1 and len(resumed["my_answers"]) == 1


def test_wordle_sync_and_xp(client):
    a = make_user(client, "wordle_a@fluencycast.com")
    state = client.get("/api/v1/games/wordle/today", headers=a).json()
    assert state["status"] == "IN_PROGRESS" and state["answer"] is None and state["guesses"] == []

    target = wd.target_word(gm.today_str())
    wrong = "aaaaa" if target != "aaaaa" else "bbbbb"

    r = client.post("/api/v1/games/wordle/guess", json={"guess": wrong, "expected_attempt": 0}, headers=a)
    assert r.status_code == 200 and len(r.json()["guesses"]) == 1

    # A stale device that still thinks there are 0 guesses must be told to resync
    stale = client.post("/api/v1/games/wordle/guess", json={"guess": wrong, "expected_attempt": 0}, headers=a)
    assert stale.status_code == 409

    bad = client.post("/api/v1/games/wordle/guess", json={"guess": "abc", "expected_attempt": 1}, headers=a)
    assert bad.status_code == 400

    win = client.post("/api/v1/games/wordle/guess", json={"guess": target, "expected_attempt": 1}, headers=a).json()
    assert win["status"] == "WON" and win["answer"] == target
    assert win["guesses"][-1]["result"] == ["correct"] * 5
    assert "wordle_win" in win["new_achievements"] and "wordle_fast" in win["new_achievements"]

    # "Another device" sees the same finished board
    other_device = client.get("/api/v1/games/wordle/today", headers=a).json()
    assert other_device["status"] == "WON" and len(other_device["guesses"]) == 2

    assert client.get("/api/v1/games/stats", headers=a).json()["xp"] == wd.xp_for_result(True, 2)


def test_wordle_evaluate_duplicates():
    assert wd.evaluate("llama", "hello") == ["present", "present", "absent", "absent", "absent"]
    assert wd.evaluate("hello", "hello") == ["correct"] * 5


def test_couple_streak_and_achievements(client, db_session):
    from app.models.game import GameActivity
    a = make_user(client, "couple_a@fluencycast.com")
    b = make_user(client, "couple_b@fluencycast.com")
    a_id = client.get("/api/v1/games/stats", headers=a).json()["user_id"]
    b_id = client.get("/api/v1/games/stats", headers=b).json()["user_id"]

    for off in (0, -1, -2):  # both active today and the 2 days before
        for uid in (a_id, b_id):
            db_session.add(GameActivity(user_id=uid, day=gm.today_str(off)))
    db_session.flush()

    cs = client.get("/api/v1/games/stats", headers=a).json()["couple_streak"]
    assert cs["days"] == 3 and cs["partner_name"] == "couple_b" and cs["today_done"] is True

    ach = client.get("/api/v1/games/achievements", headers=a).json()
    assert next(x for x in ach if x["code"] == "couple_3")["unlocked"] is True
    assert next(x for x in ach if x["code"] == "couple_3")["seen"] is False
    client.post("/api/v1/games/achievements/seen", headers=a)
    ach = client.get("/api/v1/games/achievements", headers=a).json()
    assert next(x for x in ach if x["code"] == "couple_3")["seen"] is True


# ----------------------------------------------------------------- live duels
from datetime import timedelta
from app.models.game import Duel
from app.services import live as lv


def _live_setup(client):
    a = make_user(client, "live_a@fluencycast.com")
    b = make_user(client, "live_b@fluencycast.com")
    b_id = next(p["id"] for p in client.get("/api/v1/games/players", headers=a).json() if p["name"] == "live_b")
    for text, tr in WORDS:
        client.post("/api/v1/phrases/", json={"text": text, "translation": tr, "phrase_type": "WORD"}, headers=a)
    res = client.post("/api/v1/games/duels", json={"opponent_id": b_id, "num_questions": 3, "mode": "LIVE"}, headers=a)
    assert res.status_code == 201, res.text
    return a, b, res.json()["id"]


def _right(state):
    return state["question"]["options"].index(dict(WORDS)[state["question"]["text"]])


def _rewind(db_session, duel_id, seconds):
    d = db_session.query(Duel).filter(Duel.id == duel_id).first()
    d.phase_started_at = d.phase_started_at - timedelta(seconds=seconds)
    db_session.flush()


def test_live_duel_full_flow(client, db_session):
    a, b, duel_id = _live_setup(client)
    url = f"/api/v1/games/duels/{duel_id}/live"

    assert client.get(url, headers=a).json()["phase"] == "LOBBY"
    # Only the invited player can open the room
    assert client.post(url + "/join", headers=a).status_code == 400
    # Async endpoint can't be used to bypass the live room
    assert client.post(f"/api/v1/games/duels/{duel_id}/answer", json={"question_index": 0, "choice": 0}, headers=a).status_code == 400

    st = client.post(url + "/join", headers=b).json()
    assert st["phase"] == "QUESTION" and st["index"] == 0 and st["remaining_ms"] > 0
    assert client.get(url, headers=a).json()["phase"] == "QUESTION"

    # Round 1: A right, B wrong. Nothing is revealed until both answered.
    sa = client.get(url, headers=a).json()
    r = client.post(url + "/answer", json={"question_index": 0, "choice": _right(sa)}, headers=a).json()
    assert r["phase"] == "QUESTION" and r["my_answered"] and r["reveal"] is None
    seen_by_b = client.get(url, headers=b).json()
    assert seen_by_b["opponent_answered"] is True and seen_by_b["my_answered"] is False
    # retry from a second device is idempotent
    assert client.post(url + "/answer", json={"question_index": 0, "choice": 0}, headers=a).status_code == 200

    sb = client.get(url, headers=b).json()
    r = client.post(url + "/answer", json={"question_index": 0, "choice": (_right(sb) + 1) % 4}, headers=b).json()
    assert r["phase"] == "REVEAL" and r["reveal"]["correct_index"] == _right(sb)
    assert r["my_score"] == 0 and r["opponent_score"] == 1
    # answering during reveal is refused
    assert client.post(url + "/answer", json={"question_index": 0, "choice": 0}, headers=a).status_code == 409

    # Reveal elapses -> next question
    _rewind(db_session, duel_id, lv.REVEAL_SECONDS + 1)
    assert client.get(url, headers=a).json()["index"] == 1

    # Round 2: nobody answers -> timeout fills misses and reveals
    _rewind(db_session, duel_id, lv.QUESTION_SECONDS + 1)
    st = client.get(url, headers=a).json()
    assert st["phase"] == "REVEAL" and st["reveal"]["my_choice"] == -1 and st["reveal"]["opponent_choice"] == -1

    # Round 3: both right, then everything elapses -> FINISHED with XP awarded
    _rewind(db_session, duel_id, lv.REVEAL_SECONDS + 1)
    sa = client.get(url, headers=a).json()
    assert sa["index"] == 2
    client.post(url + "/answer", json={"question_index": 2, "choice": _right(sa)}, headers=a)
    client.post(url + "/answer", json={"question_index": 2, "choice": _right(sa)}, headers=b)
    _rewind(db_session, duel_id, lv.REVEAL_SECONDS + 1)
    final = client.get(url, headers=a).json()
    assert final["phase"] == "FINISHED"
    assert final["my_score"] == 2 and final["opponent_score"] == 1 and final["i_won"] is True

    sta = client.get("/api/v1/games/stats", headers=a).json()
    stb = client.get("/api/v1/games/stats", headers=b).json()
    assert sta["wins"] == 1 and stb["losses"] == 1
    assert client.get(url, headers=b).json()["i_won"] is False


def test_live_websocket_notifies_opponent(client, db_session):
    a, b, duel_id = _live_setup(client)
    token_b = b["Authorization"].split(" ")[1]

    # An outsider / bad token is rejected
    import pytest
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/api/v1/games/ws/duels/{duel_id}?token=bad"):
            pass

    with client.websocket_connect(f"/api/v1/games/ws/duels/{duel_id}?token={token_b}") as ws:
        client.post(f"/api/v1/games/duels/{duel_id}/live/join", headers=b)
        assert ws.receive_json() == {"type": "changed"}


# ----------------------------------------------------------------- weekly, bet, cancel & pending
def test_weekly_bet_pending_and_cancel(client):
    a, b, duel_id = _live_setup(client)

    # B has 1 live invite pending
    pend_b = client.get("/api/v1/games/pending-count", headers=b).json()
    assert pend_b["live_invites"] == 1 and pend_b["count"] == 1

    # Cancel live invite
    res = client.delete(f"/api/v1/games/duels/{duel_id}", headers=a)
    assert res.status_code == 200
    assert client.get(f"/api/v1/games/duels/{duel_id}/live", headers=b).json()["phase"] == "CANCELLED"
    assert client.get("/api/v1/games/duels", headers=a).json() == []
    assert client.get("/api/v1/games/pending-count", headers=b).json()["live_invites"] == 0

    # Weekly bet & weekly XP
    bet_res = client.put("/api/v1/games/weekly/bet", json={"stake": "Quem perder faz o jantar"}, headers=a)
    assert bet_res.status_code == 200
    wk = bet_res.json()
    assert wk["stake"] == "Quem perder faz o jantar"
    assert wk["stake_updated_by_name"] == "live_a"

    # Wordle win awards weekly XP as well
    target = wd.target_word(gm.today_str())
    client.post("/api/v1/games/wordle/guess", json={"guess": target, "expected_attempt": 0}, headers=a)
    wk2 = client.get("/api/v1/games/weekly", headers=b).json()
    assert wk2["stake"] == "Quem perder faz o jantar"
    assert wk2["rows"][0]["name"] == "live_a" and wk2["rows"][0]["weekly_xp"] == wd.xp_for_result(True, 1)
