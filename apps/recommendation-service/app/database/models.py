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


class RecommendationGraphEventJournal(Base):
    __tablename__ = "recommendation_graph_event_journal"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(String(255), nullable=False)
    user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    target_user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source: Mapped[str] = mapped_column(String(128), nullable=False)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index(
            "idx_recommendation_graph_event_journal_user_target",
            "user_id",
            "target_user_id",
            "id",
        ),
        Index(
            "idx_recommendation_graph_event_journal_event_type",
            "event_type",
            "id",
        ),
    )


class RecommendationPairFeature(Base):
    __tablename__ = "recommendation_pair_features"

    viewer_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    candidate_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    has_friendship: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    has_pending_request: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )
    is_blocked_either_way: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )
    has_active_dismissal: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )
    mutual_friend_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    common_group_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_event_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_event_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index(
            "idx_recommendation_pair_features_candidate_id",
            "candidate_id",
        ),
        Index(
            "idx_recommendation_pair_features_last_event_at",
            "last_event_at",
        ),
    )


class RecommendationGlobalFallbackCandidate(Base):
    __tablename__ = "recommendation_global_fallback_candidates"

    segment_key: Mapped[str] = mapped_column(String(128), primary_key=True)
    candidate_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    fallback_score: Mapped[float] = mapped_column(Float, nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    locale: Mapped[str | None] = mapped_column(String(32), nullable=True)
    language: Mapped[str | None] = mapped_column(String(32), nullable=True)
    score_version: Mapped[str] = mapped_column(String(255), nullable=False)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    __table_args__ = (
        Index(
            "idx_recommendation_global_fallback_segment_rank",
            "segment_key",
            "rank",
        ),
        Index(
            "idx_recommendation_global_fallback_locale_language_rank",
            "locale",
            "language",
            "rank",
        ),
        Index(
            "idx_recommendation_global_fallback_rank",
            "rank",
        ),
    )
