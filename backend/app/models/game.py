import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Boolean, ForeignKey, DateTime, JSON, UniqueConstraint
from app.core.database import Base


def _now():
    return datetime.now(timezone.utc)


class GameStats(Base):
    """XP and win/loss record per user."""
    __tablename__ = "game_stats"

    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    xp = Column(Integer, default=0, nullable=False)
    games_played = Column(Integer, default=0, nullable=False)
    wins = Column(Integer, default=0, nullable=False)
    losses = Column(Integer, default=0, nullable=False)
    draws = Column(Integer, default=0, nullable=False)


class Duel(Base):
    """Asynchronous vocabulary duel between two users."""
    __tablename__ = "duels"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    challenger_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    opponent_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(20), default="ACTIVE", nullable=False)  # ACTIVE, FINISHED
    game_type = Column(String(20), default="VOCAB", nullable=False, server_default="VOCAB")  # VOCAB, CLOZE
    mode = Column(String(10), default="ASYNC", nullable=False, server_default="ASYNC")  # ASYNC, LIVE
    # Live mode state machine (server-driven, DB-backed so it survives restarts/devices)
    live_phase = Column(String(12), nullable=True)  # LOBBY, QUESTION, REVEAL
    live_index = Column(Integer, default=0, nullable=False, server_default="0")
    phase_started_at = Column(DateTime, nullable=True)

    # [{"text": str, "options": [str], "correct": int}]
    questions = Column(JSON, nullable=False)
    # [{"choice": int, "correct": bool, "time_ms": int}]
    challenger_answers = Column(JSON, nullable=False, default=list)
    opponent_answers = Column(JSON, nullable=False, default=list)

    winner_id = Column(String(36), nullable=True)
    created_at = Column(DateTime, default=_now)
    finished_at = Column(DateTime, nullable=True)



class UserAchievement(Base):
    __tablename__ = "user_achievements"

    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    code = Column(String(40), primary_key=True)
    unlocked_at = Column(DateTime, default=_now)
    seen = Column(Boolean, default=False, nullable=False)  # synced across devices


class GameActivity(Base):
    """One row per user per (Brasília) day with any study/game activity. Feeds couple streak."""
    __tablename__ = "game_activity"

    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    day = Column(String(10), primary_key=True)  # YYYY-MM-DD


class WordleGame(Base):
    """Daily word game; the server owns the state so every device sees the same board."""
    __tablename__ = "wordle_games"
    __table_args__ = (UniqueConstraint("user_id", "day", name="uq_wordle_user_day"),)

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    day = Column(String(10), nullable=False, index=True)
    guesses = Column(JSON, nullable=False, default=list)  # ["crane", ...]
    status = Column(String(20), default="IN_PROGRESS", nullable=False)  # IN_PROGRESS, WON, LOST
    finished_at = Column(DateTime, nullable=True)



class WeeklyScore(Base):
    """XP and duel wins accumulated during a single week (Monday-Sunday BRT)."""
    __tablename__ = "weekly_scores"

    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    week_key = Column(String(10), primary_key=True)  # YYYY-MM-DD of that week's Monday
    xp = Column(Integer, default=0, nullable=False)
    wins = Column(Integer, default=0, nullable=False)


class WeeklyBet(Base):
    """Shared couple bet/stake for a given week."""
    __tablename__ = "weekly_bets"

    week_key = Column(String(10), primary_key=True)  # YYYY-MM-DD of that week's Monday
    stake = Column(String(120), nullable=False)
    updated_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime, default=_now)
