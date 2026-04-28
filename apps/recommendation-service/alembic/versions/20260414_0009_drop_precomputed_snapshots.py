"""drop precomputed snapshot tables

Revision ID: 20260414_0009
Revises: 20260413_0008
Create Date: 2026-04-14 00:00:00
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260414_0009"
down_revision = "20260413_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index(
        "idx_precomputed_snapshot_rank",
        table_name="precomputed_snapshot_candidates",
    )
    op.drop_table("precomputed_snapshot_candidates")
    op.drop_table("precomputed_snapshot_runs")


def downgrade() -> None:
    op.create_table(
        "precomputed_snapshot_runs",
        sa.Column("viewer_id", sa.String(length=255), primary_key=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("generation_reason", sa.String(length=255), nullable=False),
        sa.Column("model_name", sa.String(length=255), nullable=False),
        sa.Column("candidate_count", sa.Integer(), nullable=False),
        sa.Column("score_version", sa.String(length=255), nullable=False),
    )
    op.create_table(
        "precomputed_snapshot_candidates",
        sa.Column("viewer_id", sa.String(length=255), nullable=False),
        sa.Column("candidate_id", sa.String(length=255), nullable=False),
        sa.Column("semantic_score", sa.Float(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("viewer_id", "candidate_id"),
    )
    op.create_index(
        "idx_precomputed_snapshot_rank",
        "precomputed_snapshot_candidates",
        ["viewer_id", "rank"],
    )
