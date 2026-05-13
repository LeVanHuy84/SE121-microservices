"""segment global fallback candidates by locale/language

Revision ID: 20260413_0006
Revises: 20260413_0005
Create Date: 2026-04-13 16:55:00
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260413_0006"
down_revision = "20260413_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "recommendation_global_fallback_candidates",
        sa.Column(
            "segment_key",
            sa.String(length=128),
            nullable=True,
            server_default="global::global",
        ),
    )

    op.execute(
        """
        UPDATE recommendation_global_fallback_candidates
        SET segment_key = CONCAT(
            COALESCE(locale, 'global'),
            '::',
            COALESCE(language, 'global')
        )
        WHERE segment_key IS NULL OR segment_key = ''
        """
    )

    op.alter_column(
        "recommendation_global_fallback_candidates",
        "segment_key",
        nullable=False,
        server_default=None,
    )

    op.drop_constraint(
        "recommendation_global_fallback_candidates_pkey",
        "recommendation_global_fallback_candidates",
        type_="primary",
    )
    op.create_primary_key(
        "recommendation_global_fallback_candidates_pkey",
        "recommendation_global_fallback_candidates",
        ["segment_key", "candidate_id"],
    )

    op.create_index(
        "idx_recommendation_global_fallback_segment_rank",
        "recommendation_global_fallback_candidates",
        ["segment_key", "rank"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_recommendation_global_fallback_segment_rank",
        table_name="recommendation_global_fallback_candidates",
    )

    op.drop_constraint(
        "recommendation_global_fallback_candidates_pkey",
        "recommendation_global_fallback_candidates",
        type_="primary",
    )
    op.create_primary_key(
        "recommendation_global_fallback_candidates_pkey",
        "recommendation_global_fallback_candidates",
        ["candidate_id"],
    )

    op.drop_column("recommendation_global_fallback_candidates", "segment_key")
