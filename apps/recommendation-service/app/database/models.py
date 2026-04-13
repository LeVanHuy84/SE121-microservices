from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

try:
    from pgvector.sqlalchemy import Vector

    EMBEDDING_VECTOR_COLUMN_TYPE: Any = Vector(768)
except ImportError:
    EMBEDDING_VECTOR_COLUMN_TYPE = Text()


class Base(DeclarativeBase):
    pass


class ProfileEmbedding(Base):
    __tablename__ = "profile_embeddings"

    user_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    semantic_profile_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding_json: Mapped[list[float]] = mapped_column(JSON, nullable=False)
    embedding_vector: Mapped[Any | None] = mapped_column(
        EMBEDDING_VECTOR_COLUMN_TYPE,
        nullable=True,
    )
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
    score_version: Mapped[str] = mapped_column(String(255), nullable=False)
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


class RecommendationFriendship(Base):
    __tablename__ = "recommendation_friendships"

    user_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    friend_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    __table_args__ = (
        Index(
            "idx_recommendation_friendships_friend_id",
            "friend_id",
        ),
    )


class RecommendationPendingRequest(Base):
    __tablename__ = "recommendation_pending_requests"

    requester_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    receiver_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    __table_args__ = (
        Index(
            "idx_recommendation_pending_requests_receiver_id",
            "receiver_id",
        ),
    )


class RecommendationBlock(Base):
    __tablename__ = "recommendation_blocks"

    blocker_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    blocked_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    __table_args__ = (
        Index(
            "idx_recommendation_blocks_blocked_id",
            "blocked_id",
        ),
    )


class RecommendationDismissal(Base):
    __tablename__ = "recommendation_dismissals"

    user_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    candidate_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    __table_args__ = (
        Index(
            "idx_recommendation_dismissals_expires_at",
            "expires_at",
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
