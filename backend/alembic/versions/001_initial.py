"""initial migration

Revision ID: 001_initial
Revises: 
Create Date: 2026-09-05 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '001_initial'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # users
    op.create_table(
        'users',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('hashed_password', sa.String(length=255), nullable=False),
        sa.Column('full_name', sa.String(length=255), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)

    # user_profiles
    op.create_table(
        'user_profiles',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('english_level', sa.String(length=10), nullable=True),
        sa.Column('goal', sa.String(length=50), nullable=True),
        sa.Column('daily_goal_minutes', sa.Integer(), nullable=True),
        sa.Column('current_streak', sa.Integer(), nullable=True),
        sa.Column('last_study_date', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id')
    )

    # videos
    op.create_table(
        'videos',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('youtube_id', sa.String(length=30), nullable=False),
        sa.Column('url', sa.String(length=500), nullable=False),
        sa.Column('title', sa.String(length=500), nullable=False),
        sa.Column('channel', sa.String(length=255), nullable=True),
        sa.Column('thumbnail_url', sa.String(length=500), nullable=True),
        sa.Column('duration', sa.Float(), nullable=True),
        sa.Column('language', sa.String(length=10), nullable=True),
        sa.Column('category', sa.String(length=30), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_videos_user_id'), 'videos', ['user_id'], unique=False)
    op.create_index(op.f('ix_videos_youtube_id'), 'videos', ['youtube_id'], unique=False)

    # transcript_segments
    op.create_table(
        'transcript_segments',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('video_id', sa.String(length=36), nullable=False),
        sa.Column('sequence', sa.Integer(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('start_time', sa.Float(), nullable=False),
        sa.Column('end_time', sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(['video_id'], ['videos.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_transcript_segments_video_id'), 'transcript_segments', ['video_id'], unique=False)
    op.create_index('ix_transcript_segments_video_start', 'transcript_segments', ['video_id', 'start_time'], unique=False)

    # saved_phrases
    op.create_table(
        'saved_phrases',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('video_id', sa.String(length=36), nullable=False),
        sa.Column('transcript_segment_id', sa.String(length=36), nullable=True),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('translation', sa.Text(), nullable=True),
        sa.Column('context_sentence', sa.Text(), nullable=True),
        sa.Column('timestamp', sa.Float(), nullable=True),
        sa.Column('phrase_type', sa.String(length=30), nullable=True),
        sa.Column('difficulty', sa.String(length=20), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=True),
        sa.Column('repetitions', sa.Integer(), nullable=True),
        sa.Column('ease_factor', sa.Float(), nullable=True),
        sa.Column('interval_days', sa.Integer(), nullable=True),
        sa.Column('next_review_at', sa.DateTime(), nullable=True),
        sa.Column('last_reviewed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['transcript_segment_id'], ['transcript_segments.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['video_id'], ['videos.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_saved_phrases_next_review_at'), 'saved_phrases', ['next_review_at'], unique=False)
    op.create_index(op.f('ix_saved_phrases_user_id'), 'saved_phrases', ['user_id'], unique=False)
    op.create_index(op.f('ix_saved_phrases_video_id'), 'saved_phrases', ['video_id'], unique=False)
    op.create_index('ix_saved_phrases_user_next_review', 'saved_phrases', ['user_id', 'next_review_at'], unique=False)
    op.create_index('ix_saved_phrases_user_status', 'saved_phrases', ['user_id', 'status'], unique=False)

    # phrase_reviews
    op.create_table(
        'phrase_reviews',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('saved_phrase_id', sa.String(length=36), nullable=False),
        sa.Column('quality', sa.Integer(), nullable=False),
        sa.Column('interval_days', sa.Integer(), nullable=False),
        sa.Column('ease_factor', sa.Float(), nullable=False),
        sa.Column('reviewed_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['saved_phrase_id'], ['saved_phrases.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_phrase_reviews_saved_phrase_id'), 'phrase_reviews', ['saved_phrase_id'], unique=False)

    # study_sessions
    op.create_table(
        'study_sessions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('video_id', sa.String(length=36), nullable=True),
        sa.Column('duration_seconds', sa.Integer(), nullable=True),
        sa.Column('phrases_reviewed', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['video_id'], ['videos.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_study_sessions_user_id'), 'study_sessions', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_table('study_sessions')
    op.drop_table('phrase_reviews')
    op.drop_table('saved_phrases')
    op.drop_table('transcript_segments')
    op.drop_table('videos')
    op.drop_table('user_profiles')
    op.drop_table('users')
