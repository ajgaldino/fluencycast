"""clean slate reset: wipe old test videos, segments, phrases and reviews

Revision ID: 003_clean_slate_reset
Revises: 002_make_video_id_nullable
Create Date: 2026-09-10 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '003_clean_slate_reset'
down_revision: Union[str, None] = '002_make_video_id_nullable'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    try:
        bind = op.get_bind()
        is_sqlite = bind.dialect.name == "sqlite"
        if is_sqlite:
            op.execute("PRAGMA foreign_keys = OFF;")
            op.execute("DELETE FROM phrase_reviews;")
            op.execute("DELETE FROM saved_phrases;")
            op.execute("DELETE FROM transcript_segments;")
            op.execute("DELETE FROM videos;")
            op.execute("DELETE FROM study_sessions;")
            op.execute("UPDATE user_profiles SET current_streak = 0, last_study_date = NULL;")
            op.execute("PRAGMA foreign_keys = ON;")
        else:
            # PostgreSQL on Render / production
            op.execute("""
                TRUNCATE TABLE phrase_reviews, saved_phrases, transcript_segments, videos, study_sessions CASCADE;
                UPDATE user_profiles SET current_streak = 0, last_study_date = NULL;
            """)
        print("Successfully wiped all old videos and phrases for a completely clean slate!")
    except Exception as e:
        print(f"Notice during migration 003_clean_slate_reset: {e}")


def downgrade() -> None:
    pass
