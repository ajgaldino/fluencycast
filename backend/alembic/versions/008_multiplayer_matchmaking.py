"""add match_queue and multiplayer_matches tables

Revision ID: 008_multiplayer_matchmaking
Revises: 007_weekly_gamification
Create Date: 2026-11-21 23:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '008_multiplayer_matchmaking'
down_revision: Union[str, None] = '007_weekly_gamification'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    tables = insp.get_table_names()

    if "match_queue" not in tables:
        op.create_table(
            "match_queue",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("game_type", sa.String(20), nullable=False, index=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="WAITING", index=True),
            sa.Column("match_id", sa.String(36), nullable=True),
            sa.Column("created_at", sa.DateTime, nullable=True),
        )

    if "multiplayer_matches" not in tables:
        op.create_table(
            "multiplayer_matches",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("game_type", sa.String(20), nullable=False),
            sa.Column("player1_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("player2_id", sa.String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="ACTIVE"),
            sa.Column("state", sa.JSON, nullable=False),
            sa.Column("winner_id", sa.String(36), nullable=True),
            sa.Column("created_at", sa.DateTime, nullable=True),
            sa.Column("finished_at", sa.DateTime, nullable=True),
        )


def downgrade() -> None:
    op.drop_table("multiplayer_matches")
    op.drop_table("match_queue")
