"""initial recommendation state tables

Revision ID: 20260410_0001
Revises:
Create Date: 2026-04-10 18:30:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260410_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "profile_embeddings",
        sa.Column("user_id", sa.String(length=255), primary_key=True),
        sa.Column("semantic_profile_text", sa.Text(), nullable=True),
        sa.Column("embedding_json", sa.JSON(), nullable=False),
        sa.Column("dimensions", sa.Integer(), nullable=False),
        sa.Column("model_name", sa.String(length=255), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "precomputed_snapshot_runs",
        sa.Column("viewer_id", sa.String(length=255), primary_key=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("generation_reason", sa.String(length=255), nullable=False),
        sa.Column("model_name", sa.String(length=255), nullable=False),
        sa.Column("candidate_count", sa.Integer(), nullable=False),
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

    op.create_table(
        "outbox_events",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("topic", sa.String(length=255), nullable=False),
        sa.Column("event_type", sa.String(length=255), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("processed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "idx_outbox_events_processed_created_at",
        "outbox_events",
        ["processed", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_outbox_events_processed_created_at", table_name="outbox_events")
    op.drop_table("outbox_events")
    op.drop_index(
        "idx_precomputed_snapshot_rank",
        table_name="precomputed_snapshot_candidates",
    )
    op.drop_table("precomputed_snapshot_candidates")
    op.drop_table("precomputed_snapshot_runs")
    op.drop_table("profile_embeddings")
