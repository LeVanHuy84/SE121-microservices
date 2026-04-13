"""add global fallback candidates table

Revision ID: 20260413_0005
Revises: 20260413_0004
Create Date: 2026-04-13 16:20:00
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260413_0005"
down_revision = "20260413_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recommendation_global_fallback_candidates",
        sa.Column("candidate_id", sa.String(length=255), nullable=False),
        sa.Column("fallback_score", sa.Float(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("locale", sa.String(length=32), nullable=True),
        sa.Column("language", sa.String(length=32), nullable=True),
        sa.Column("score_version", sa.String(length=255), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("candidate_id"),
    )
    op.create_index(
        "idx_recommendation_global_fallback_locale_language_rank",
        "recommendation_global_fallback_candidates",
        ["locale", "language", "rank"],
    )
    op.create_index(
        "idx_recommendation_global_fallback_rank",
        "recommendation_global_fallback_candidates",
        ["rank"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_recommendation_global_fallback_rank",
        table_name="recommendation_global_fallback_candidates",
    )
    op.drop_index(
        "idx_recommendation_global_fallback_locale_language_rank",
        table_name="recommendation_global_fallback_candidates",
    )
    op.drop_table("recommendation_global_fallback_candidates")
