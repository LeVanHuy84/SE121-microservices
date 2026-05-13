"""add recommendation graph projection tables

Revision ID: 20260411_0003
Revises: 20260411_0002
Create Date: 2026-04-11 22:25:00
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260411_0003"
down_revision = "20260411_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recommendation_friendships",
        sa.Column("user_id", sa.String(length=255), nullable=False),
        sa.Column("friend_id", sa.String(length=255), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "friend_id"),
    )
    op.create_index(
        "idx_recommendation_friendships_friend_id",
        "recommendation_friendships",
        ["friend_id"],
    )

    op.create_table(
        "recommendation_pending_requests",
        sa.Column("requester_id", sa.String(length=255), nullable=False),
        sa.Column("receiver_id", sa.String(length=255), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("requester_id", "receiver_id"),
    )
    op.create_index(
        "idx_recommendation_pending_requests_receiver_id",
        "recommendation_pending_requests",
        ["receiver_id"],
    )

    op.create_table(
        "recommendation_blocks",
        sa.Column("blocker_id", sa.String(length=255), nullable=False),
        sa.Column("blocked_id", sa.String(length=255), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("blocker_id", "blocked_id"),
    )
    op.create_index(
        "idx_recommendation_blocks_blocked_id",
        "recommendation_blocks",
        ["blocked_id"],
    )

    op.create_table(
        "recommendation_dismissals",
        sa.Column("user_id", sa.String(length=255), nullable=False),
        sa.Column("candidate_id", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "candidate_id"),
    )
    op.create_index(
        "idx_recommendation_dismissals_expires_at",
        "recommendation_dismissals",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_recommendation_dismissals_expires_at",
        table_name="recommendation_dismissals",
    )
    op.drop_table("recommendation_dismissals")
    op.drop_index(
        "idx_recommendation_blocks_blocked_id",
        table_name="recommendation_blocks",
    )
    op.drop_table("recommendation_blocks")
    op.drop_index(
        "idx_recommendation_pending_requests_receiver_id",
        table_name="recommendation_pending_requests",
    )
    op.drop_table("recommendation_pending_requests")
    op.drop_index(
        "idx_recommendation_friendships_friend_id",
        table_name="recommendation_friendships",
    )
    op.drop_table("recommendation_friendships")
