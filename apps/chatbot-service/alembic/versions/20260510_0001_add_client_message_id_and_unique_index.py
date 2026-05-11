"""add client_message_id and unique partial index

Revision ID: 20260510_0001
Revises:
Create Date: 2026-05-10 09:30:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260510_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_messages",
        sa.Column("client_message_id", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ux_chat_messages_user_client_message_id_not_null",
        "chat_messages",
        ["user_id", "client_message_id"],
        unique=True,
        postgresql_where=sa.text("client_message_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ux_chat_messages_user_client_message_id_not_null",
        table_name="chat_messages",
    )
    op.drop_column("chat_messages", "client_message_id")
