from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class ProfileEmbedding(Base):
    __tablename__ = "profile_embeddings"

    user_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    semantic_profile_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding_json: Mapped[list[float]] = mapped_column(JSON, nullable=False)
    dimensions: Mapped[int] = mapped_column(Integer, nullable=False)
    model_name: Mapped[str] = mapped_column(String(255), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class PrecomputedSnapshotRun(Base):
    __tablename__ = "precomputed_snapshot_runs"

    viewer_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    generation_reason: Mapped[str] = mapped_column(String(255), nullable=False)
    model_name: Mapped[str] = mapped_column(String(255), nullable=False)
    candidate_count: Mapped[int] = mapped_column(Integer, nullable=False)


class PrecomputedSnapshotCandidate(Base):
    __tablename__ = "precomputed_snapshot_candidates"

    viewer_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    candidate_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    semantic_score: Mapped[float] = mapped_column(Float, nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    __table_args__ = (
        Index(
            "idx_precomputed_snapshot_rank",
            "viewer_id",
            "rank",
        ),
    )


class OutboxEvent(Base):
    __tablename__ = "outbox_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    topic: Mapped[str] = mapped_column(String(255), nullable=False)
    event_type: Mapped[str] = mapped_column(String(255), nullable=False)
    payload_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    processed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    processed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    __table_args__ = (
        Index(
            "idx_outbox_events_processed_created_at",
            "processed",
            "created_at",
        ),
    )
