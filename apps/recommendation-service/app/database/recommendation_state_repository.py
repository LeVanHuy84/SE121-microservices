from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator
from uuid import uuid4

from sqlalchemy import delete, inspect, select, text, update
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.config import settings
from app.database.models import (
    Base,
    OutboxEvent,
    PrecomputedSnapshotCandidate,
    PrecomputedSnapshotRun,
    ProfileEmbedding,
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
            "precomputed_snapshot_runs",
            "precomputed_snapshot_candidates",
            "outbox_events",
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

    def save_embedding_and_enqueue_result(
        self,
        user_id: str,
        semantic_profile_text: str | None,
        embedding: list[float],
        model_name: str,
        updated_at: str,
        topic: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> str:
        with self.session_scope() as session:
            self._upsert_profile_embedding(
                session,
                user_id,
                semantic_profile_text,
                embedding,
                model_name,
                updated_at,
            )
            return self._insert_outbox_event(session, topic, event_type, payload)

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

    def replace_precomputed_snapshot(
        self,
        viewer_id: str,
        candidates: list[dict[str, Any]],
        generated_at: str,
        generation_reason: str,
        model_name: str,
    ):
        generated_at_dt = self._parse_datetime(generated_at)

        with self.session_scope() as session:
            self._upsert_snapshot_run(
                session,
                viewer_id,
                generated_at_dt,
                generation_reason,
                model_name,
                len(candidates),
            )
            session.execute(
                delete(PrecomputedSnapshotCandidate).where(
                    PrecomputedSnapshotCandidate.viewer_id == viewer_id
                )
            )

            if candidates:
                session.add_all(
                    [
                        PrecomputedSnapshotCandidate(
                            viewer_id=viewer_id,
                            candidate_id=str(candidate["candidateId"]),
                            semantic_score=float(candidate["semanticScore"]),
                            rank=int(candidate["rank"]),
                            generated_at=generated_at_dt,
                        )
                        for candidate in candidates
                    ]
                )

    def clear_precomputed_snapshot(
        self,
        viewer_id: str,
        generated_at: str,
        generation_reason: str,
        model_name: str,
    ):
        self.replace_precomputed_snapshot(
            viewer_id,
            [],
            generated_at,
            generation_reason,
            model_name,
        )

    def get_precomputed_snapshot(
        self, viewer_id: str, limit: int
    ) -> dict[str, Any] | None:
        with self.session_scope() as session:
            run = session.get(PrecomputedSnapshotRun, viewer_id)
            if run is None:
                return None

            rows = session.scalars(
                select(PrecomputedSnapshotCandidate)
                .where(PrecomputedSnapshotCandidate.viewer_id == viewer_id)
                .order_by(PrecomputedSnapshotCandidate.rank.asc())
                .limit(max(1, int(limit)))
            ).all()

            return {
                "viewerId": run.viewer_id,
                "generatedAt": run.generated_at.isoformat(),
                "generationReason": run.generation_reason,
                "modelName": run.model_name,
                "candidateCount": int(run.candidate_count),
                "candidates": [
                    {
                        "candidateId": row.candidate_id,
                        "semanticScore": float(row.semantic_score),
                        "rank": int(row.rank),
                        "generatedAt": row.generated_at.isoformat(),
                    }
                    for row in rows
                ],
            }

    def enqueue_outbox_event(
        self,
        topic: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> str:
        with self.session_scope() as session:
            return self._insert_outbox_event(session, topic, event_type, payload)

    def list_pending_outbox_events(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.session_scope() as session:
            rows = session.scalars(
                select(OutboxEvent)
                .where(OutboxEvent.processed.is_(False))
                .order_by(OutboxEvent.created_at.asc())
                .limit(max(1, int(limit)))
            ).all()

            return [
                {
                    "id": row.id,
                    "topic": row.topic,
                    "eventType": row.event_type,
                    "payload": row.payload_json,
                    "createdAt": row.created_at.isoformat(),
                    "attemptCount": int(row.attempt_count),
                    "lastError": row.last_error,
                }
                for row in rows
            ]

    def lock_outbox_event(self, event_id: str) -> bool:
        with self.session_scope() as session:
            result = session.execute(
                update(OutboxEvent)
                .where(OutboxEvent.id == event_id, OutboxEvent.processed.is_(False))
                .values(
                    processed=True,
                    processed_at=self._now(),
                    attempt_count=OutboxEvent.attempt_count + 1,
                    last_error=None,
                )
            )
            return result.rowcount == 1

    def reset_outbox_event(self, event_id: str, last_error: str | None = None):
        with self.session_scope() as session:
            session.execute(
                update(OutboxEvent)
                .where(OutboxEvent.id == event_id)
                .values(
                    processed=False,
                    processed_at=None,
                    last_error=last_error,
                )
            )

    def get_outbox_event(self, event_id: str) -> dict[str, Any] | None:
        with self.session_scope() as session:
            row = session.get(OutboxEvent, event_id)
            if row is None:
                return None
            return {
                "id": row.id,
                "topic": row.topic,
                "eventType": row.event_type,
                "payload": row.payload_json,
                "processed": bool(row.processed),
                "processedAt": row.processed_at.isoformat()
                if row.processed_at
                else None,
                "attemptCount": int(row.attempt_count),
                "lastError": row.last_error,
                "createdAt": row.created_at.isoformat(),
            }

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

    def _upsert_snapshot_run(
        self,
        session: Session,
        viewer_id: str,
        generated_at: datetime,
        generation_reason: str,
        model_name: str,
        candidate_count: int,
    ):
        values = {
            "viewer_id": viewer_id,
            "generated_at": generated_at,
            "generation_reason": generation_reason,
            "model_name": model_name,
            "candidate_count": candidate_count,
        }
        stmt = self._build_upsert_statement(
            PrecomputedSnapshotRun.__table__,
            values,
            conflict_columns=["viewer_id"],
            update_columns=[
                "generated_at",
                "generation_reason",
                "model_name",
                "candidate_count",
            ],
        )
        session.execute(stmt)

    def _insert_outbox_event(
        self,
        session: Session,
        topic: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> str:
        outbox_id = str(uuid4())
        session.add(
            OutboxEvent(
                id=outbox_id,
                topic=topic,
                event_type=event_type,
                payload_json=payload,
                processed=False,
                processed_at=None,
                attempt_count=0,
                last_error=None,
                created_at=self._now(),
            )
        )
        return outbox_id

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
