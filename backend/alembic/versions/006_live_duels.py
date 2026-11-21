"""add live duel columns

Revision ID: 006_live_duels
Revises: 005_games_v2
Create Date: 2026-11-21 22:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '006_live_duels'
down_revision: Union[str, None] = '005_games_v2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "duels" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("duels")}
    if "mode" not in cols:
        op.add_column("duels", sa.Column("mode", sa.String(10), nullable=False, server_default="ASYNC"))
    if "live_phase" not in cols:
        op.add_column("duels", sa.Column("live_phase", sa.String(12), nullable=True))
    if "live_index" not in cols:
        op.add_column("duels", sa.Column("live_index", sa.Integer, nullable=False, server_default="0"))
    if "phase_started_at" not in cols:
        op.add_column("duels", sa.Column("phase_started_at", sa.DateTime, nullable=True))


def downgrade() -> None:
    for col in ("phase_started_at", "live_index", "live_phase", "mode"):
        op.drop_column("duels", col)
