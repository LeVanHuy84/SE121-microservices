"""add graph event journal and pair features

Revision ID: 20260413_0008
Revises: 20260413_0007
Create Date: 2026-04-13 22:50:00
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260413_0008"
down_revision = "20260413_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recommendation_graph_event_journal",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("event_type", sa.String(length=255), nullable=False),
        sa.Column("user_id", sa.String(length=255), nullable=False),
        sa.Column("target_user_id", sa.String(length=255), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(length=128), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "idx_recommendation_graph_event_journal_user_target",
        "recommendation_graph_event_journal",
        ["user_id", "target_user_id", "id"],
    )
    op.create_index(
        "idx_recommendation_graph_event_journal_event_type",
        "recommendation_graph_event_journal",
        ["event_type", "id"],
    )

    op.create_table(
        "recommendation_pair_features",
        sa.Column("viewer_id", sa.String(length=255), nullable=False),
        sa.Column("candidate_id", sa.String(length=255), nullable=False),
        sa.Column("has_friendship", sa.Boolean(), nullable=False),
        sa.Column("has_pending_request", sa.Boolean(), nullable=False),
        sa.Column("is_blocked_either_way", sa.Boolean(), nullable=False),
        sa.Column("has_active_dismissal", sa.Boolean(), nullable=False),
        sa.Column("mutual_friend_count", sa.Integer(), nullable=False),
        sa.Column("common_group_count", sa.Integer(), nullable=False),
        sa.Column("last_event_type", sa.String(length=255), nullable=True),
        sa.Column("last_event_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("viewer_id", "candidate_id"),
    )
    op.create_index(
        "idx_recommendation_pair_features_candidate_id",
        "recommendation_pair_features",
        ["candidate_id"],
    )
    op.create_index(
        "idx_recommendation_pair_features_last_event_at",
        "recommendation_pair_features",
        ["last_event_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_recommendation_pair_features_last_event_at",
        table_name="recommendation_pair_features",
    )
    op.drop_index(
        "idx_recommendation_pair_features_candidate_id",
        table_name="recommendation_pair_features",
    )
    op.drop_table("recommendation_pair_features")

    op.drop_index(
        "idx_recommendation_graph_event_journal_event_type",
        table_name="recommendation_graph_event_journal",
    )
    op.drop_index(
        "idx_recommendation_graph_event_journal_user_target",
        table_name="recommendation_graph_event_journal",
    )
    op.drop_table("recommendation_graph_event_journal")