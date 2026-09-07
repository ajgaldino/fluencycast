"""make video_id nullable in saved_phrases

Revision ID: 002_make_video_id_nullable
Revises: 001_initial
Create Date: 2026-09-06 22:45:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '002_make_video_id_nullable'
down_revision: Union[str, None] = '001_initial'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Alter video_id in saved_phrases to be nullable
    try:
        op.alter_column('saved_phrases', 'video_id',
                        existing_type=sa.String(length=36),
                        nullable=True)
    except Exception as e:
        print(f"Notice during migration 002_make_video_id_nullable upgrade: {e}")


def downgrade() -> None:
    try:
        op.alter_column('saved_phrases', 'video_id',
                        existing_type=sa.String(length=36),
                        nullable=False)
    except Exception as e:
        print(f"Notice during migration 002_make_video_id_nullable downgrade: {e}")
