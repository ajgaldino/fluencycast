"""add game_type to duels; achievements, activity and wordle tables

Revision ID: 005_games_v2
Revises: 004_add_games
Create Date: 2026-11-21 21:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '005_games_v2'
down_revision: Union[str, None] = '004_add_games'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    tables = insp.get_table_names()

    if "duels" in tables and "game_type" not in {c["name"] for c in insp.get_columns("duels")}:
        op.add_column("duels", sa.Column("game_type", sa.String(20), nullable=False, server_default="VOCAB"))

    if "user_achievements" not in tables:
        op.create_table(
            "user_achievements",
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("code", sa.String(40), primary_key=True),
            sa.Column("unlocked_at", sa.DateTime, nullable=True),
            sa.Column("seen", sa.Boolean, nullable=False, server_default=sa.false()),
        )
    if "game_activity" not in tables:
        op.create_table(
            "game_activity",
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("day", sa.String(10), primary_key=True),
        )
    if "wordle_games" not in tables:
        op.create_table(
            "wordle_games",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("day", sa.String(10), nullable=False, index=True),
            sa.Column("guesses", sa.JSON, nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="IN_PROGRESS"),
            sa.Column("finished_at", sa.DateTime, nullable=True),
            sa.UniqueConstraint("user_id", "day", name="uq_wordle_user_day"),
        )


def downgrade() -> None:
    op.drop_table("wordle_games")
    op.drop_table("game_activity")
    op.drop_table("user_achievements")
    op.drop_column("duels", "game_type")
