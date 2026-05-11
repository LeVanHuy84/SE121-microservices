"""add recommendation emotion profiles table

Revision ID: 20260510_0010
Revises: 20260414_0009
Create Date: 2026-05-10 00:00:00
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260510_0010"
down_revision = "20260414_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recommendation_emotion_profiles",
        sa.Column("user_id", sa.String(length=255), primary_key=True),
        sa.Column("risk_score", sa.Float(), nullable=False),
        sa.Column("recent_negativity_score", sa.Float(), nullable=False),
        sa.Column("dominant_emotion", sa.String(length=64), nullable=True),
        sa.Column("emotion_scores_json", sa.JSON(), nullable=False),
        sa.Column("source_event_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "idx_recommendation_emotion_profiles_updated_at",
        "recommendation_emotion_profiles",
        ["updated_at"],
    )
    op.create_index(
        "idx_recommendation_emotion_profiles_source_event_at",
        "recommendation_emotion_profiles",
        ["source_event_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_recommendation_emotion_profiles_source_event_at",
        table_name="recommendation_emotion_profiles",
    )
    op.drop_index(
        "idx_recommendation_emotion_profiles_updated_at",
        table_name="recommendation_emotion_profiles",
    )
    op.drop_table("recommendation_emotion_profiles")
