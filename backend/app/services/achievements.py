from typing import Iterable, List, Set

from sqlalchemy.orm import Session

from app.models.game import GameStats, UserAchievement, WordleGame
from app.models.phrase import SavedPhrase
from app.models.review import PhraseReview

# code -> (icon, name, description)
CATALOG = {
    "first_duel": ("⚔️", "Primeiro duelo", "Complete seu primeiro duelo"),
    "first_win": ("🏆", "Primeira vitória", "Vença um duelo"),
    "wins_5": ("🥇", "Campeão", "Vença 5 duelos"),
    "wins_10": ("👑", "Lenda da Arena", "Vença 10 duelos"),
    "perfect_duel": ("💯", "Gabaritou!", "Acerte todas as perguntas de um duelo"),
    "cloze_first": ("🎵", "Completa a letra", "Complete um duelo de Complete a Frase"),
    "wordle_win": ("🔤", "Palavra do dia", "Acerte a palavra do dia"),
    "wordle_fast": ("⚡", "Mente rápida", "Acerte a palavra do dia em até 3 tentativas"),
    "xp_100": ("⭐", "100 XP", "Alcance 100 XP"),
    "xp_500": ("🌟", "500 XP", "Alcance 500 XP"),
    "xp_1000": ("💫", "1000 XP", "Alcance 1000 XP"),
    "reviewer_100": ("🧠", "Revisor dedicado", "Faça 100 revisões de frases"),
    "couple_3": ("💞", "3 dias juntos", "Estudem juntos 3 dias seguidos"),
    "couple_7": ("🔥", "Semana a dois", "Estudem juntos 7 dias seguidos"),
    "couple_30": ("💍", "Mês a dois", "Estudem juntos 30 dias seguidos"),
}


def check_achievements(
    db: Session, user_id: str, extra: Iterable[str] = (), couple_streak: int = 0
) -> List[str]:
    """Unlocks every achievement whose condition holds. Returns the newly unlocked codes."""
    from app.services.gamification import get_or_create_stats

    stats = get_or_create_stats(db, user_id)
    earned: Set[str] = set(extra)

    if stats.games_played >= 1:
        earned.add("first_duel")
    if stats.wins >= 1:
        earned.add("first_win")
    if stats.wins >= 5:
        earned.add("wins_5")
    if stats.wins >= 10:
        earned.add("wins_10")
    for threshold in (100, 500, 1000):
        if stats.xp >= threshold:
            earned.add(f"xp_{threshold}")
    for threshold in (3, 7, 30):
        if couple_streak >= threshold:
            earned.add(f"couple_{threshold}")

    if db.query(WordleGame).filter(WordleGame.user_id == user_id, WordleGame.status == "WON").count() >= 1:
        earned.add("wordle_win")

    reviews = (
        db.query(PhraseReview)
        .join(SavedPhrase, PhraseReview.saved_phrase_id == SavedPhrase.id)
        .filter(SavedPhrase.user_id == user_id)
        .count()
    )
    if reviews >= 100:
        earned.add("reviewer_100")

    have = {a.code for a in db.query(UserAchievement).filter(UserAchievement.user_id == user_id).all()}
    new = [c for c in earned if c in CATALOG and c not in have]
    for code in new:
        db.add(UserAchievement(user_id=user_id, code=code, seen=False))
    if new:
        db.flush()
    return new
