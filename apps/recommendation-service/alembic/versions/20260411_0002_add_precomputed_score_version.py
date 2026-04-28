"""add score version to precomputed snapshot runs

Revision ID: 20260411_0002
Revises: 20260410_0001
Create Date: 2026-04-11 21:55:00
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260411_0002"
down_revision = "20260410_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "precomputed_snapshot_runs",
        sa.Column(
            "score_version",
            sa.String(length=255),
            nullable=False,
            server_default="retrieval-dot-product-v1",
        ),
    )
    op.alter_column(
        "precomputed_snapshot_runs",
        "score_version",
        server_default=None,
    )


def downgrade() -> None:
    op.drop_column("precomputed_snapshot_runs", "score_version")
