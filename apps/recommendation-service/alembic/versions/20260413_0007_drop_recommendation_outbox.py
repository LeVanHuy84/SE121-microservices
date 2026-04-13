"""drop recommendation outbox table

Revision ID: 20260413_0007
Revises: 20260413_0006
Create Date: 2026-04-13 21:20:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260413_0007"
down_revision = "20260413_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index(
        "idx_outbox_events_processed_created_at",
        table_name="outbox_events",
    )
    op.drop_table("outbox_events")


def downgrade() -> None:
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
