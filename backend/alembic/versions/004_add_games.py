"""add game_stats and duels tables

Revision ID: 004_add_games
Revises: 003_clean_slate_reset
Create Date: 2026-11-21 20:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '004_add_games'
down_revision: Union[str, None] = '003_clean_slate_reset'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = sa.inspect(bind).get_table_names()

    if "game_stats" not in existing:
        op.create_table(
            "game_stats",
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("xp", sa.Integer, nullable=False, server_default="0"),
            sa.Column("games_played", sa.Integer, nullable=False, server_default="0"),
            sa.Column("wins", sa.Integer, nullable=False, server_default="0"),
            sa.Column("losses", sa.Integer, nullable=False, server_default="0"),
            sa.Column("draws", sa.Integer, nullable=False, server_default="0"),
        )

    if "duels" not in existing:
        op.create_table(
            "duels",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("challenger_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("opponent_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="ACTIVE"),
            sa.Column("questions", sa.JSON, nullable=False),
            sa.Column("challenger_answers", sa.JSON, nullable=False),
            sa.Column("opponent_answers", sa.JSON, nullable=False),
            sa.Column("winner_id", sa.String(36), nullable=True),
            sa.Column("created_at", sa.DateTime, nullable=True),
            sa.Column("finished_at", sa.DateTime, nullable=True),
        )


def downgrade() -> None:
    op.drop_table("duels")
    op.drop_table("game_stats")
