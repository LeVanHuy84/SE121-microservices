"""add pgvector column for profile embeddings

Revision ID: 20260413_0004
Revises: 20260411_0003
Create Date: 2026-04-13 09:30:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260413_0004"
down_revision = "20260411_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect_name = bind.dialect.name

    if dialect_name != "postgresql":
        op.add_column(
            "profile_embeddings",
            sa.Column("embedding_vector", sa.Text(), nullable=True),
        )
        return

    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("ALTER TABLE profile_embeddings ADD COLUMN embedding_vector vector(768)")
    op.execute(
        """
        UPDATE profile_embeddings
        SET embedding_vector = CAST(embedding_json::text AS vector)
        WHERE embedding_json IS NOT NULL
          AND dimensions = 768
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_profile_embeddings_embedding_vector_hnsw
        ON profile_embeddings
        USING hnsw (embedding_vector vector_cosine_ops)
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    dialect_name = bind.dialect.name

    if dialect_name == "postgresql":
        op.execute("DROP INDEX IF EXISTS idx_profile_embeddings_embedding_vector_hnsw")

    op.drop_column("profile_embeddings", "embedding_vector")
