from __future__ import annotations

import math
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from sqlalchemy import delete, func, inspect, select, text, union_all
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, aliased

from app.core.config import settings
from app.database.models import (
    Base,
    ProfileEmbedding,
    RecommendationBlock,
    RecommendationDismissal,
    RecommendationFriendship,
    RecommendationGlobalFallbackCandidate,
    RecommendationGraphEventJournal,
    RecommendationPairFeature,
    RecommendationPendingRequest,
)
from app.database.session import create_engine_for_url, create_session_factory


class RecommendationStateRepository:
    def __init__(self, database_url: str | None = None):
        self.database_url = database_url or settings.DATABASE_URL
        self.engine: Engine = create_engine_for_url(self.database_url)
        self.session_factory = create_session_factory(self.engine)

    def create_schema(self):
        Base.metadata.create_all(self.engine)

    def validate_connection(self):
        with self.engine.connect() as connection:
            connection.execute(text("SELECT 1"))

    def validate_schema(self):
        inspector = inspect(self.engine)
        required_tables = {
            "profile_embeddings",
            "recommendation_global_fallback_candidates",
            "recommendation_friendships",
            "recommendation_pending_requests",
            "recommendation_blocks",
            "recommendation_dismissals",
            "recommendation_graph_event_journal",
            "recommendation_pair_features",
        }
        missing_tables = sorted(
            table_name
            for table_name in required_tables
            if not inspector.has_table(table_name)
        )
        if missing_tables:
            raise RuntimeError(
                "Recommendation database schema is missing required tables: "
                + ", ".join(missing_tables)
            )

    def close(self):
        self.engine.dispose()

    def upsert_profile_embedding(
        self,
        user_id: str,
        semantic_profile_text: str | None,
        embedding: list[float],
        model_name: str,
        updated_at: str,
    ):
        with self.session_scope() as session:
            self._upsert_profile_embedding(
                session,
                user_id,
                semantic_profile_text,
                embedding,
                model_name,
                updated_at,
            )

    def delete_profile_embedding(self, user_id: str):
        with self.session_scope() as session:
            session.execute(
                delete(ProfileEmbedding).where(ProfileEmbedding.user_id == user_id)
            )

    def get_profile_embedding(self, user_id: str) -> dict[str, Any] | None:
        with self.session_scope() as session:
            row = session.get(ProfileEmbedding, user_id)
            if row is None:
                return None
            return self._serialize_profile_embedding(row)

    def list_profile_embeddings(self) -> list[dict[str, Any]]:
        with self.session_scope() as session:
            rows = session.scalars(
                select(ProfileEmbedding)
                .where(ProfileEmbedding.dimensions > 0)
                .order_by(ProfileEmbedding.user_id.asc())
            ).all()
            return [self._serialize_profile_embedding(row) for row in rows]

    def search_semantic_candidates(
        self,
        viewer_id: str,
        limit: int,
        overscan: int,
    ) -> list[dict[str, Any]]:
        normalized_viewer_id = str(viewer_id or "").strip()
        if not normalized_viewer_id:
            return []

        safe_limit = max(1, int(limit))
        safe_overscan = max(safe_limit, int(overscan))

        viewer_row = self.get_profile_embedding(normalized_viewer_id)
        if viewer_row is None:
            return []

        viewer_embedding = [float(value) for value in viewer_row.get("embedding", [])]
        if not viewer_embedding:
            return []

        if self.engine.dialect.name == "postgresql":
            return self._search_semantic_candidates_postgresql(
                normalized_viewer_id,
                viewer_embedding,
                safe_limit,
                safe_overscan,
            )

        return self._search_semantic_candidates_fallback(
            normalized_viewer_id,
            viewer_embedding,
            safe_limit,
            safe_overscan,
        )

    def apply_graph_friend_request_sent(self, user_id: str, target_user_id: str):
        with self.session_scope() as session:
            self._upsert_pending_request(
                session,
                user_id,
                target_user_id,
                self._now(),
            )

    def apply_graph_friend_request_canceled(self, user_id: str, target_user_id: str):
        with self.session_scope() as session:
            self._delete_pending_request(session, user_id, target_user_id)

    def apply_graph_friend_request_accepted(self, user_id: str, target_user_id: str):
        with self.session_scope() as session:
            now = self._now()
            self._delete_pending_request(session, target_user_id, user_id)
            self._upsert_friendship(session, user_id, target_user_id, now)
            self._upsert_friendship(session, target_user_id, user_id, now)

    def apply_graph_friend_request_declined(self, user_id: str, target_user_id: str):
        with self.session_scope() as session:
            self._delete_pending_request(session, target_user_id, user_id)

    def apply_graph_friendship_removed(self, user_id: str, target_user_id: str):
        with self.session_scope() as session:
            self._delete_friendship(session, user_id, target_user_id)
            self._delete_friendship(session, target_user_id, user_id)

    def apply_graph_user_blocked(self, user_id: str, target_user_id: str):
        with self.session_scope() as session:
            self._upsert_block(session, user_id, target_user_id, self._now())
            self._delete_friendship(session, user_id, target_user_id)
            self._delete_friendship(session, target_user_id, user_id)
            self._delete_pending_request(session, user_id, target_user_id)
            self._delete_pending_request(session, target_user_id, user_id)

    def apply_graph_user_unblocked(self, user_id: str, target_user_id: str):
        with self.session_scope() as session:
            self._delete_block(session, user_id, target_user_id)

    def apply_graph_recommendation_dismissed(
        self,
        user_id: str,
        target_user_id: str,
        expires_at: str | datetime,
    ):
        with self.session_scope() as session:
            self._upsert_dismissal(
                session,
                user_id,
                target_user_id,
                self._parse_datetime(expires_at),
                self._now(),
            )

    def record_graph_event(
        self,
        event_type: str,
        user_id: str,
        target_user_id: str,
        occurred_at: str | datetime,
        source: str,
        payload: dict[str, Any],
    ):
        with self.session_scope() as session:
            session.add(
                RecommendationGraphEventJournal(
                    event_type=str(event_type).strip(),
                    user_id=str(user_id).strip(),
                    target_user_id=str(target_user_id).strip(),
                    occurred_at=self._parse_datetime(occurred_at),
                    source=str(source).strip() or "unknown",
                    payload_json=dict(payload),
                    ingested_at=self._now(),
                )
            )

    def list_graph_event_journal(self, limit: int = 100) -> list[dict[str, Any]]:
        safe_limit = max(1, int(limit))

        with self.session_scope() as session:
            rows = session.scalars(
                select(RecommendationGraphEventJournal)
                .order_by(RecommendationGraphEventJournal.id.desc())
                .limit(safe_limit)
            ).all()
            return [
                {
                    "id": int(row.id),
                    "eventType": row.event_type,
                    "userId": row.user_id,
                    "targetUserId": row.target_user_id,
                    "occurredAt": row.occurred_at.isoformat(),
                    "source": row.source,
                    "payload": dict(row.payload_json or {}),
                    "ingestedAt": row.ingested_at.isoformat(),
                }
                for row in rows
            ]

    def refresh_graph_pair_features_for_event(
        self,
        user_id: str,
        target_user_id: str,
        event_type: str,
        event_at: str | datetime,
    ):
        event_at_dt = self._parse_datetime(event_at)

        with self.session_scope() as session:
            self._refresh_graph_pair_feature(
                session,
                viewer_id=user_id,
                candidate_id=target_user_id,
                last_event_type=event_type,
                last_event_at=event_at_dt,
            )
            self._refresh_graph_pair_feature(
                session,
                viewer_id=target_user_id,
                candidate_id=user_id,
                last_event_type=event_type,
                last_event_at=event_at_dt,
            )

    def upsert_graph_pair_feature(
        self,
        viewer_id: str,
        candidate_id: str,
        *,
        mutual_friend_count: int = 0,
        common_group_count: int = 0,
        last_event_type: str | None = None,
        last_event_at: str | datetime | None = None,
    ):
        normalized_viewer_id = str(viewer_id or "").strip()
        normalized_candidate_id = str(candidate_id or "").strip()
        if not normalized_viewer_id or not normalized_candidate_id:
            return

        with self.session_scope() as session:
            self._upsert_graph_pair_feature(
                session,
                viewer_id=normalized_viewer_id,
                candidate_id=normalized_candidate_id,
                has_friendship=self._has_friendship(
                    session,
                    normalized_viewer_id,
                    normalized_candidate_id,
                )
                or self._has_friendship(
                    session,
                    normalized_candidate_id,
                    normalized_viewer_id,
                ),
                has_pending_request=self._has_pending_request(
                    session,
                    normalized_viewer_id,
                    normalized_candidate_id,
                )
                or self._has_pending_request(
                    session,
                    normalized_candidate_id,
                    normalized_viewer_id,
                ),
                is_blocked_either_way=self._has_block(
                    session,
                    normalized_viewer_id,
                    normalized_candidate_id,
                )
                or self._has_block(
                    session,
                    normalized_candidate_id,
                    normalized_viewer_id,
                ),
                has_active_dismissal=self._has_active_dismissal(
                    session,
                    normalized_viewer_id,
                    normalized_candidate_id,
                ),
                mutual_friend_count=max(0, int(mutual_friend_count)),
                common_group_count=max(0, int(common_group_count)),
                last_event_type=str(last_event_type).strip()
                if isinstance(last_event_type, str) and last_event_type.strip()
                else None,
                last_event_at=self._parse_datetime(last_event_at)
                if last_event_at is not None
                else None,
            )

    def get_graph_pair_features(
        self,
        viewer_id: str,
        candidate_ids: list[str],
    ) -> dict[str, dict[str, Any]]:
        normalized_viewer_id = str(viewer_id or "").strip()
        normalized_candidate_ids = sorted(
            {
                str(candidate_id or "").strip()
                for candidate_id in candidate_ids
                if str(candidate_id or "").strip()
            }
        )
        if not normalized_viewer_id or not normalized_candidate_ids:
            return {}

        with self.session_scope() as session:
            rows = session.scalars(
                select(RecommendationPairFeature).where(
                    RecommendationPairFeature.viewer_id == normalized_viewer_id,
                    RecommendationPairFeature.candidate_id.in_(normalized_candidate_ids),
                )
            ).all()
            features = {
                row.candidate_id: {
                    "viewerId": row.viewer_id,
                    "candidateId": row.candidate_id,
                    "hasFriendship": bool(row.has_friendship),
                    "hasPendingRequest": bool(row.has_pending_request),
                    "isBlockedEitherWay": bool(row.is_blocked_either_way),
                    "hasActiveDismissal": bool(row.has_active_dismissal),
                    "mutualFriendCount": int(row.mutual_friend_count),
                    "commonGroupCount": int(row.common_group_count),
                    "lastEventType": row.last_event_type,
                    "lastEventAt": row.last_event_at.isoformat()
                    if row.last_event_at is not None
                    else None,
                    "updatedAt": row.updated_at.isoformat(),
                }
                for row in rows
            }
            mutual_friend_counts = self._get_mutual_friend_counts(
                session,
                normalized_viewer_id,
                normalized_candidate_ids,
            )

            for candidate_id in normalized_candidate_ids:
                mutual_friend_count = mutual_friend_counts.get(candidate_id, 0)
                if candidate_id in features:
                    features[candidate_id]["mutualFriendCount"] = mutual_friend_count
                    continue

                if mutual_friend_count <= 0:
                    continue

                features[candidate_id] = {
                    "viewerId": normalized_viewer_id,
                    "candidateId": candidate_id,
                    "hasFriendship": False,
                    "hasPendingRequest": False,
                    "isBlockedEitherWay": False,
                    "hasActiveDismissal": False,
                    "mutualFriendCount": mutual_friend_count,
                    "commonGroupCount": 0,
                    "lastEventType": None,
                    "lastEventAt": None,
                    "updatedAt": self._now().isoformat(),
                }

            return features

    def is_candidate_excluded_by_graph_projection(
        self,
        viewer_id: str,
        candidate_id: str,
    ) -> bool:
        if not viewer_id or not candidate_id or viewer_id == candidate_id:
            return True

        with self.session_scope() as session:
            return (
                self._has_friendship(session, viewer_id, candidate_id)
                or self._has_friendship(session, candidate_id, viewer_id)
                or self._has_pending_request(session, viewer_id, candidate_id)
                or self._has_pending_request(session, candidate_id, viewer_id)
                or self._has_block(session, viewer_id, candidate_id)
                or self._has_block(session, candidate_id, viewer_id)
                or self._has_active_dismissal(session, viewer_id, candidate_id)
            )

    def get_graph_excluded_candidate_ids(
        self,
        viewer_id: str,
        candidate_ids: list[str],
    ) -> set[str]:
        normalized_viewer_id = str(viewer_id or "").strip()
        normalized_candidate_ids = {
            str(candidate_id or "").strip()
            for candidate_id in candidate_ids
            if str(candidate_id or "").strip()
        }

        if not normalized_viewer_id:
            return normalized_candidate_ids

        excluded_ids = set()
        if normalized_viewer_id in normalized_candidate_ids:
            excluded_ids.add(normalized_viewer_id)
            normalized_candidate_ids.remove(normalized_viewer_id)

        if not normalized_candidate_ids:
            return excluded_ids

        candidate_id_list = sorted(normalized_candidate_ids)
        with self.session_scope() as session:
            exclusion_union = union_all(
                select(RecommendationFriendship.friend_id.label("candidate_id")).where(
                    RecommendationFriendship.user_id == normalized_viewer_id,
                    RecommendationFriendship.friend_id.in_(candidate_id_list),
                ),
                select(RecommendationFriendship.user_id.label("candidate_id")).where(
                    RecommendationFriendship.user_id.in_(candidate_id_list),
                    RecommendationFriendship.friend_id == normalized_viewer_id,
                ),
                select(
                    RecommendationPendingRequest.receiver_id.label("candidate_id")
                ).where(
                    RecommendationPendingRequest.requester_id == normalized_viewer_id,
                    RecommendationPendingRequest.receiver_id.in_(candidate_id_list),
                ),
                select(
                    RecommendationPendingRequest.requester_id.label("candidate_id")
                ).where(
                    RecommendationPendingRequest.requester_id.in_(candidate_id_list),
                    RecommendationPendingRequest.receiver_id == normalized_viewer_id,
                ),
                select(RecommendationBlock.blocked_id.label("candidate_id")).where(
                    RecommendationBlock.blocker_id == normalized_viewer_id,
                    RecommendationBlock.blocked_id.in_(candidate_id_list),
                ),
                select(RecommendationBlock.blocker_id.label("candidate_id")).where(
                    RecommendationBlock.blocker_id.in_(candidate_id_list),
                    RecommendationBlock.blocked_id == normalized_viewer_id,
                ),
                select(
                    RecommendationDismissal.candidate_id.label("candidate_id")
                ).where(
                    RecommendationDismissal.user_id == normalized_viewer_id,
                    RecommendationDismissal.candidate_id.in_(candidate_id_list),
                    RecommendationDismissal.expires_at > self._now(),
                ),
            ).subquery()

            excluded_ids.update(
                session.scalars(
                    select(exclusion_union.c.candidate_id).distinct()
                ).all()
            )

        return {str(candidate_id) for candidate_id in excluded_ids}

    def replace_global_fallback_candidates(
        self,
        candidates: list[dict[str, Any]],
        generated_at: str | datetime,
        score_version: str = "global-fallback-v1",
        locale: str | None = None,
        language: str | None = None,
    ):
        generated_at_dt = self._parse_datetime(generated_at)
        normalized_locale = str(locale or "").strip() or None
        normalized_language = str(language or "").strip() or None
        segment_key = self._resolve_fallback_segment_key(
            normalized_locale,
            normalized_language,
        )

        with self.session_scope() as session:
            session.execute(
                delete(RecommendationGlobalFallbackCandidate).where(
                    RecommendationGlobalFallbackCandidate.segment_key == segment_key
                )
            )

            if candidates:
                session.add_all(
                    [
                        RecommendationGlobalFallbackCandidate(
                            segment_key=segment_key,
                            candidate_id=str(candidate["candidateId"]),
                            fallback_score=float(candidate["fallbackScore"]),
                            rank=int(candidate["rank"]),
                            locale=normalized_locale,
                            language=normalized_language,
                            score_version=score_version,
                            generated_at=generated_at_dt,
                        )
                        for candidate in candidates
                    ]
                )

    def list_global_fallback_candidates(
        self,
        offset: int,
        limit: int,
        locale: str | None = None,
        language: str | None = None,
    ) -> list[dict[str, Any]]:
        safe_offset = max(0, int(offset))
        safe_limit = max(1, int(limit))
        normalized_locale = str(locale or "").strip() or None
        normalized_language = str(language or "").strip() or None
        segment_key = self._resolve_fallback_segment_key(
            normalized_locale,
            normalized_language,
        )

        with self.session_scope() as session:
            rows = session.scalars(
                select(RecommendationGlobalFallbackCandidate)
                .where(RecommendationGlobalFallbackCandidate.segment_key == segment_key)
                .order_by(RecommendationGlobalFallbackCandidate.rank.asc())
                .offset(safe_offset)
                .limit(safe_limit)
            ).all()

            return [
                {
                    "candidateId": row.candidate_id,
                    "fallbackScore": float(row.fallback_score),
                    "rank": int(row.rank),
                    "locale": row.locale,
                    "language": row.language,
                    "scoreVersion": row.score_version,
                    "generatedAt": row.generated_at.isoformat(),
                }
                for row in rows
            ]

    def _resolve_fallback_segment_key(
        self,
        locale: str | None,
        language: str | None,
    ) -> str:
        return f"{locale or 'global'}::{language or 'global'}"

    def get_candidate_negative_signal_counts(
        self,
        candidate_ids: list[str],
    ) -> dict[str, dict[str, int]]:
        normalized_candidate_ids = [
            str(candidate_id or "").strip()
            for candidate_id in candidate_ids
            if str(candidate_id or "").strip()
        ]
        if not normalized_candidate_ids:
            return {}

        with self.session_scope() as session:
            block_rows = session.execute(
                select(
                    RecommendationBlock.blocked_id,
                    func.count().label("signal_count"),
                )
                .where(RecommendationBlock.blocked_id.in_(normalized_candidate_ids))
                .group_by(RecommendationBlock.blocked_id)
            ).all()

            dismissal_rows = session.execute(
                select(
                    RecommendationDismissal.candidate_id,
                    func.count().label("signal_count"),
                )
                .where(
                    RecommendationDismissal.candidate_id.in_(
                        normalized_candidate_ids
                    ),
                    RecommendationDismissal.expires_at > self._now(),
                )
                .group_by(RecommendationDismissal.candidate_id)
            ).all()

        signal_counts: dict[str, dict[str, int]] = {
            candidate_id: {
                "blockCount": 0,
                "dismissalCount": 0,
            }
            for candidate_id in normalized_candidate_ids
        }

        for row in block_rows:
            signal_counts[str(row.blocked_id)]["blockCount"] = int(row.signal_count)

        for row in dismissal_rows:
            signal_counts[str(row.candidate_id)]["dismissalCount"] = int(
                row.signal_count
            )

        return signal_counts


    @contextmanager
    def session_scope(self) -> Iterator[Session]:
        session: Session = self.session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def _upsert_profile_embedding(
        self,
        session: Session,
        user_id: str,
        semantic_profile_text: str | None,
        embedding: list[float],
        model_name: str,
        updated_at: str,
    ):
        values = {
            "user_id": user_id,
            "semantic_profile_text": semantic_profile_text,
            "embedding_json": [float(value) for value in embedding],
            "dimensions": len(embedding),
            "model_name": model_name,
            "updated_at": self._parse_datetime(updated_at),
        }
        stmt = self._build_upsert_statement(
            ProfileEmbedding.__table__,
            values,
            conflict_columns=["user_id"],
            update_columns=[
                "semantic_profile_text",
                "embedding_json",
                "dimensions",
                "model_name",
                "updated_at",
            ],
        )
        session.execute(stmt)

        # PostgreSQL vector columns require explicit cast to vector for writes.
        if self.engine.dialect.name == "postgresql":
            session.execute(
                text(
                    """
                    UPDATE profile_embeddings
                    SET embedding_vector = CAST(:embedding_vector AS vector)
                    WHERE user_id = :user_id
                    """
                ),
                {
                    "user_id": user_id,
                    "embedding_vector": self._to_pgvector_literal(embedding),
                },
            )

    def _upsert_friendship(
        self,
        session: Session,
        user_id: str,
        friend_id: str,
        updated_at: datetime,
    ):
        values = {
            "user_id": user_id,
            "friend_id": friend_id,
            "updated_at": updated_at,
        }
        stmt = self._build_upsert_statement(
            RecommendationFriendship.__table__,
            values,
            conflict_columns=["user_id", "friend_id"],
            update_columns=["updated_at"],
        )
        session.execute(stmt)

    def _delete_friendship(self, session: Session, user_id: str, friend_id: str):
        session.execute(
            delete(RecommendationFriendship).where(
                RecommendationFriendship.user_id == user_id,
                RecommendationFriendship.friend_id == friend_id,
            )
        )

    def _upsert_pending_request(
        self,
        session: Session,
        requester_id: str,
        receiver_id: str,
        updated_at: datetime,
    ):
        values = {
            "requester_id": requester_id,
            "receiver_id": receiver_id,
            "updated_at": updated_at,
        }
        stmt = self._build_upsert_statement(
            RecommendationPendingRequest.__table__,
            values,
            conflict_columns=["requester_id", "receiver_id"],
            update_columns=["updated_at"],
        )
        session.execute(stmt)

    def _delete_pending_request(
        self,
        session: Session,
        requester_id: str,
        receiver_id: str,
    ):
        session.execute(
            delete(RecommendationPendingRequest).where(
                RecommendationPendingRequest.requester_id == requester_id,
                RecommendationPendingRequest.receiver_id == receiver_id,
            )
        )

    def _upsert_block(
        self,
        session: Session,
        blocker_id: str,
        blocked_id: str,
        updated_at: datetime,
    ):
        values = {
            "blocker_id": blocker_id,
            "blocked_id": blocked_id,
            "updated_at": updated_at,
        }
        stmt = self._build_upsert_statement(
            RecommendationBlock.__table__,
            values,
            conflict_columns=["blocker_id", "blocked_id"],
            update_columns=["updated_at"],
        )
        session.execute(stmt)

    def _delete_block(self, session: Session, blocker_id: str, blocked_id: str):
        session.execute(
            delete(RecommendationBlock).where(
                RecommendationBlock.blocker_id == blocker_id,
                RecommendationBlock.blocked_id == blocked_id,
            )
        )

    def _upsert_dismissal(
        self,
        session: Session,
        user_id: str,
        candidate_id: str,
        expires_at: datetime,
        updated_at: datetime,
    ):
        values = {
            "user_id": user_id,
            "candidate_id": candidate_id,
            "expires_at": expires_at,
            "updated_at": updated_at,
        }
        stmt = self._build_upsert_statement(
            RecommendationDismissal.__table__,
            values,
            conflict_columns=["user_id", "candidate_id"],
            update_columns=["expires_at", "updated_at"],
        )
        session.execute(stmt)

    def _refresh_graph_pair_feature(
        self,
        session: Session,
        viewer_id: str,
        candidate_id: str,
        last_event_type: str,
        last_event_at: datetime,
    ):
        has_friendship = self._has_friendship(
            session,
            viewer_id,
            candidate_id,
        ) or self._has_friendship(session, candidate_id, viewer_id)
        has_pending_request = self._has_pending_request(
            session,
            viewer_id,
            candidate_id,
        ) or self._has_pending_request(
            session,
            candidate_id,
            viewer_id,
        )
        is_blocked_either_way = self._has_block(
            session,
            viewer_id,
            candidate_id,
        ) or self._has_block(
            session,
            candidate_id,
            viewer_id,
        )
        has_active_dismissal = self._has_active_dismissal(
            session,
            viewer_id,
            candidate_id,
        )

        self._upsert_graph_pair_feature(
            session,
            viewer_id=viewer_id,
            candidate_id=candidate_id,
            has_friendship=has_friendship,
            has_pending_request=has_pending_request,
            is_blocked_either_way=is_blocked_either_way,
            has_active_dismissal=has_active_dismissal,
            mutual_friend_count=self._count_mutual_friends(
                session,
                viewer_id,
                candidate_id,
            ),
            common_group_count=0,
            last_event_type=last_event_type,
            last_event_at=last_event_at,
        )

    def _upsert_graph_pair_feature(
        self,
        session: Session,
        viewer_id: str,
        candidate_id: str,
        has_friendship: bool,
        has_pending_request: bool,
        is_blocked_either_way: bool,
        has_active_dismissal: bool,
        mutual_friend_count: int,
        common_group_count: int,
        last_event_type: str | None,
        last_event_at: datetime | None,
    ):
        values = {
            "viewer_id": viewer_id,
            "candidate_id": candidate_id,
            "has_friendship": has_friendship,
            "has_pending_request": has_pending_request,
            "is_blocked_either_way": is_blocked_either_way,
            "has_active_dismissal": has_active_dismissal,
            "mutual_friend_count": mutual_friend_count,
            "common_group_count": common_group_count,
            "last_event_type": last_event_type,
            "last_event_at": last_event_at,
            "updated_at": self._now(),
        }
        stmt = self._build_upsert_statement(
            RecommendationPairFeature.__table__,
            values,
            conflict_columns=["viewer_id", "candidate_id"],
            update_columns=[
                "has_friendship",
                "has_pending_request",
                "is_blocked_either_way",
                "has_active_dismissal",
                "mutual_friend_count",
                "common_group_count",
                "last_event_type",
                "last_event_at",
                "updated_at",
            ],
        )
        session.execute(stmt)

    def _has_friendship(self, session: Session, user_id: str, friend_id: str) -> bool:
        return session.get(RecommendationFriendship, (user_id, friend_id)) is not None

    def _has_pending_request(
        self,
        session: Session,
        requester_id: str,
        receiver_id: str,
    ) -> bool:
        return (
            session.get(
                RecommendationPendingRequest,
                (requester_id, receiver_id),
            )
            is not None
        )

    def _has_block(self, session: Session, blocker_id: str, blocked_id: str) -> bool:
        return session.get(RecommendationBlock, (blocker_id, blocked_id)) is not None

    def _has_active_dismissal(
        self,
        session: Session,
        user_id: str,
        candidate_id: str,
    ) -> bool:
        return (
            session.scalar(
                select(RecommendationDismissal)
                .where(
                    RecommendationDismissal.user_id == user_id,
                    RecommendationDismissal.candidate_id == candidate_id,
                    RecommendationDismissal.expires_at > self._now(),
                )
                .limit(1)
            )
            is not None
        )

    def _count_mutual_friends(
        self,
        session: Session,
        viewer_id: str,
        candidate_id: str,
    ) -> int:
        return self._get_mutual_friend_counts(
            session,
            viewer_id,
            [candidate_id],
        ).get(candidate_id, 0)

    def _get_mutual_friend_counts(
        self,
        session: Session,
        viewer_id: str,
        candidate_ids: list[str],
    ) -> dict[str, int]:
        normalized_viewer_id = str(viewer_id or "").strip()
        normalized_candidate_ids = sorted(
            {
                str(candidate_id or "").strip()
                for candidate_id in candidate_ids
                if str(candidate_id or "").strip()
                and str(candidate_id or "").strip() != normalized_viewer_id
            }
        )
        if not normalized_viewer_id or not normalized_candidate_ids:
            return {}

        viewer_friend = aliased(RecommendationFriendship)
        candidate_friend = aliased(RecommendationFriendship)
        rows = session.execute(
            select(
                candidate_friend.user_id.label("candidate_id"),
                func.count(func.distinct(viewer_friend.friend_id)).label(
                    "mutual_friend_count"
                ),
            )
            .join(
                candidate_friend,
                viewer_friend.friend_id == candidate_friend.friend_id,
            )
            .where(
                viewer_friend.user_id == normalized_viewer_id,
                candidate_friend.user_id.in_(normalized_candidate_ids),
            )
            .group_by(candidate_friend.user_id)
        ).all()

        return {
            str(row.candidate_id): int(row.mutual_friend_count)
            for row in rows
            if int(row.mutual_friend_count) > 0
        }

    def _build_upsert_statement(
        self,
        table,
        values: dict[str, Any],
        conflict_columns: list[str],
        update_columns: list[str],
    ):
        if self.engine.dialect.name == "postgresql":
            stmt = postgresql_insert(table).values(**values)
        elif self.engine.dialect.name == "sqlite":
            stmt = sqlite_insert(table).values(**values)
        else:
            raise RuntimeError(
                "Unsupported SQL dialect for recommendation repository: "
                f"{self.engine.dialect.name}"
            )

        return stmt.on_conflict_do_update(
            index_elements=conflict_columns,
            set_={column: values[column] for column in update_columns},
        )

    def _serialize_profile_embedding(self, row: ProfileEmbedding) -> dict[str, Any]:
        return {
            "userId": row.user_id,
            "semanticProfileText": row.semantic_profile_text,
            "embedding": [float(value) for value in row.embedding_json or []],
            "dimensions": int(row.dimensions),
            "modelName": row.model_name,
            "updatedAt": row.updated_at.isoformat(),
        }

    def _search_semantic_candidates_postgresql(
        self,
        viewer_id: str,
        viewer_embedding: list[float],
        limit: int,
        overscan: int,
    ) -> list[dict[str, Any]]:
        with self.session_scope() as session:
            rows = session.execute(
                text(
                    """
                    SELECT
                        pe.user_id,
                        pe.semantic_profile_text,
                        1 - (
                            pe.embedding_vector <=> CAST(:viewer_embedding AS vector)
                        ) AS retrieval_score
                    FROM profile_embeddings pe
                    WHERE pe.user_id <> :viewer_id
                      AND pe.embedding_vector IS NOT NULL
                      AND pe.dimensions = :viewer_dimensions
                    ORDER BY pe.embedding_vector <=> CAST(:viewer_embedding AS vector)
                    LIMIT :overscan
                    """
                ),
                {
                    "viewer_id": viewer_id,
                    "viewer_embedding": self._to_pgvector_literal(viewer_embedding),
                    "viewer_dimensions": len(viewer_embedding),
                    "overscan": overscan,
                },
            ).all()

        ranked_rows = [
            {
                "candidateId": str(row.user_id),
                "candidateProfileText": row.semantic_profile_text,
                "retrievalScore": float(row.retrieval_score),
            }
            for row in rows
            if row.retrieval_score is not None
            and math.isfinite(float(row.retrieval_score))
        ]
        return self._post_filter_semantic_candidates(viewer_id, ranked_rows, limit)

    def _search_semantic_candidates_fallback(
        self,
        viewer_id: str,
        viewer_embedding: list[float],
        limit: int,
        overscan: int,
    ) -> list[dict[str, Any]]:
        candidate_rows = self.list_profile_embeddings()
        ranked_rows: list[dict[str, Any]] = []

        for candidate_row in candidate_rows:
            candidate_id = str(candidate_row["userId"])
            if candidate_id == viewer_id:
                continue

            candidate_embedding = [
                float(value) for value in candidate_row.get("embedding", [])
            ]
            if (
                not candidate_embedding
                or len(candidate_embedding) != len(viewer_embedding)
            ):
                continue

            retrieval_score = sum(
                float(a) * float(b)
                for a, b in zip(viewer_embedding, candidate_embedding, strict=False)
            )
            if not math.isfinite(retrieval_score):
                continue

            ranked_rows.append(
                {
                    "candidateId": candidate_id,
                    "candidateProfileText": candidate_row.get("semanticProfileText"),
                    "retrievalScore": float(retrieval_score),
                }
            )

        ranked_rows.sort(
            key=lambda candidate: (
                -float(candidate["retrievalScore"]),
                str(candidate["candidateId"]),
            )
        )
        return self._post_filter_semantic_candidates(
            viewer_id,
            ranked_rows[:overscan],
            limit,
        )

    def _post_filter_semantic_candidates(
        self,
        viewer_id: str,
        ranked_candidates: list[dict[str, Any]],
        limit: int,
    ) -> list[dict[str, Any]]:
        if not ranked_candidates:
            return []

        excluded_ids = self.get_graph_excluded_candidate_ids(
            viewer_id,
            [str(candidate["candidateId"]) for candidate in ranked_candidates],
        )

        filtered_candidates = [
            candidate
            for candidate in ranked_candidates
            if str(candidate["candidateId"]) not in excluded_ids
        ]
        return filtered_candidates[:limit]

    def _to_pgvector_literal(self, embedding: list[float]) -> str:
        return "[" + ",".join(str(float(value)) for value in embedding) + "]"

    def _parse_datetime(self, value: str | datetime) -> datetime:
        if isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value

        normalized = str(value).strip().replace("Z", "+00:00")
        resolved = datetime.fromisoformat(normalized)
        if resolved.tzinfo is None:
            return resolved.replace(tzinfo=timezone.utc)
        return resolved

    def _now(self) -> datetime:
        return datetime.now(timezone.utc)
