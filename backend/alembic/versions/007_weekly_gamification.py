"""add weekly_scores and weekly_bets tables

Revision ID: 007_weekly_gamification
Revises: 006_live_duels
Create Date: 2026-11-21 23:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '007_weekly_gamification'
down_revision: Union[str, None] = '006_live_duels'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    tables = insp.get_table_names()

    if "weekly_scores" not in tables:
        op.create_table(
            "weekly_scores",
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("week_key", sa.String(10), primary_key=True),
            sa.Column("xp", sa.Integer, nullable=False, server_default="0"),
            sa.Column("wins", sa.Integer, nullable=False, server_default="0"),
        )

    if "weekly_bets" not in tables:
        op.create_table(
            "weekly_bets",
            sa.Column("week_key", sa.String(10), primary_key=True),
            sa.Column("stake", sa.String(120), nullable=False),
            sa.Column("updated_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("updated_at", sa.DateTime, nullable=True),
        )


def downgrade() -> None:
    op.drop_table("weekly_bets")
    op.drop_table("weekly_scores")
