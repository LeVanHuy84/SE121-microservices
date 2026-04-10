from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any
from uuid import uuid4


class RecommendationStateRepository:
    def __init__(self, db_path: str):
        self._db_path = db_path
        self._lock = RLock()

    def ensure_schema(self):
        with self._lock:
            if self._db_path != ":memory:":
                Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)

            with self._connect() as connection:
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS profile_embeddings (
                        user_id TEXT PRIMARY KEY,
                        semantic_profile_text TEXT,
                        embedding_json TEXT NOT NULL,
                        dimensions INTEGER NOT NULL,
                        model_name TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS precomputed_snapshot_runs (
                        viewer_id TEXT PRIMARY KEY,
                        generated_at TEXT NOT NULL,
                        generation_reason TEXT NOT NULL,
                        model_name TEXT NOT NULL,
                        candidate_count INTEGER NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS precomputed_snapshot_candidates (
                        viewer_id TEXT NOT NULL,
                        candidate_id TEXT NOT NULL,
                        semantic_score REAL NOT NULL,
                        rank INTEGER NOT NULL,
                        generated_at TEXT NOT NULL,
                        PRIMARY KEY (viewer_id, candidate_id)
                    );

                    CREATE INDEX IF NOT EXISTS idx_precomputed_snapshot_rank
                    ON precomputed_snapshot_candidates(viewer_id, rank);

                    CREATE TABLE IF NOT EXISTS outbox_events (
                        id TEXT PRIMARY KEY,
                        topic TEXT NOT NULL,
                        event_type TEXT NOT NULL,
                        payload_json TEXT NOT NULL,
                        processed INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL
                    );

                    CREATE INDEX IF NOT EXISTS idx_outbox_events_processed_created_at
                    ON outbox_events(processed, created_at);
                    """
                )
                connection.commit()

    def upsert_profile_embedding(
        self,
        user_id: str,
        semantic_profile_text: str | None,
        embedding: list[float],
        model_name: str,
        updated_at: str,
    ):
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO profile_embeddings (
                    user_id,
                    semantic_profile_text,
                    embedding_json,
                    dimensions,
                    model_name,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    semantic_profile_text = excluded.semantic_profile_text,
                    embedding_json = excluded.embedding_json,
                    dimensions = excluded.dimensions,
                    model_name = excluded.model_name,
                    updated_at = excluded.updated_at
                """,
                (
                    user_id,
                    semantic_profile_text,
                    json.dumps([float(value) for value in embedding]),
                    len(embedding),
                    model_name,
                    updated_at,
                ),
            )
            connection.commit()

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
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN")
            try:
                connection.execute(
                    """
                    INSERT INTO profile_embeddings (
                        user_id,
                        semantic_profile_text,
                        embedding_json,
                        dimensions,
                        model_name,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET
                        semantic_profile_text = excluded.semantic_profile_text,
                        embedding_json = excluded.embedding_json,
                        dimensions = excluded.dimensions,
                        model_name = excluded.model_name,
                        updated_at = excluded.updated_at
                    """,
                    (
                        user_id,
                        semantic_profile_text,
                        json.dumps([float(value) for value in embedding]),
                        len(embedding),
                        model_name,
                        updated_at,
                    ),
                )
                outbox_id = self._insert_outbox_event(
                    connection,
                    topic,
                    event_type,
                    payload,
                )
                connection.commit()
                return outbox_id
            except Exception:
                connection.rollback()
                raise

    def enqueue_outbox_event(
        self,
        topic: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> str:
        with self._lock, self._connect() as connection:
            outbox_id = self._insert_outbox_event(connection, topic, event_type, payload)
            connection.commit()
            return outbox_id

    def get_profile_embedding(self, user_id: str) -> dict[str, Any] | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT
                    user_id,
                    semantic_profile_text,
                    embedding_json,
                    dimensions,
                    model_name,
                    updated_at
                FROM profile_embeddings
                WHERE user_id = ?
                """,
                (user_id,),
            ).fetchone()

        if row is None:
            return None

        return {
            "userId": row["user_id"],
            "semanticProfileText": row["semantic_profile_text"],
            "embedding": json.loads(row["embedding_json"]),
            "dimensions": int(row["dimensions"]),
            "modelName": row["model_name"],
            "updatedAt": row["updated_at"],
        }

    def list_profile_embeddings(self) -> list[dict[str, Any]]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    user_id,
                    semantic_profile_text,
                    embedding_json,
                    dimensions,
                    model_name,
                    updated_at
                FROM profile_embeddings
                WHERE dimensions > 0
                ORDER BY user_id ASC
                """
            ).fetchall()

        return [
            {
                "userId": row["user_id"],
                "semanticProfileText": row["semantic_profile_text"],
                "embedding": json.loads(row["embedding_json"]),
                "dimensions": int(row["dimensions"]),
                "modelName": row["model_name"],
                "updatedAt": row["updated_at"],
            }
            for row in rows
        ]

    def replace_precomputed_snapshot(
        self,
        viewer_id: str,
        candidates: list[dict[str, Any]],
        generated_at: str,
        generation_reason: str,
        model_name: str,
    ):
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO precomputed_snapshot_runs (
                    viewer_id,
                    generated_at,
                    generation_reason,
                    model_name,
                    candidate_count
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(viewer_id) DO UPDATE SET
                    generated_at = excluded.generated_at,
                    generation_reason = excluded.generation_reason,
                    model_name = excluded.model_name,
                    candidate_count = excluded.candidate_count
                """,
                (
                    viewer_id,
                    generated_at,
                    generation_reason,
                    model_name,
                    len(candidates),
                ),
            )
            connection.execute(
                """
                DELETE FROM precomputed_snapshot_candidates
                WHERE viewer_id = ?
                """,
                (viewer_id,),
            )

            if candidates:
                connection.executemany(
                    """
                    INSERT INTO precomputed_snapshot_candidates (
                        viewer_id,
                        candidate_id,
                        semantic_score,
                        rank,
                        generated_at
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            viewer_id,
                            str(candidate["candidateId"]),
                            float(candidate["semanticScore"]),
                            int(candidate["rank"]),
                            generated_at,
                        )
                        for candidate in candidates
                    ],
                )

            connection.commit()

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
        with self._lock, self._connect() as connection:
            run = connection.execute(
                """
                SELECT
                    viewer_id,
                    generated_at,
                    generation_reason,
                    model_name,
                    candidate_count
                FROM precomputed_snapshot_runs
                WHERE viewer_id = ?
                """,
                (viewer_id,),
            ).fetchone()
            if run is None:
                return None

            rows = connection.execute(
                """
                SELECT
                    candidate_id,
                    semantic_score,
                    rank,
                    generated_at
                FROM precomputed_snapshot_candidates
                WHERE viewer_id = ?
                ORDER BY rank ASC
                LIMIT ?
                """,
                (viewer_id, limit),
            ).fetchall()

        return {
            "viewerId": run["viewer_id"],
            "generatedAt": run["generated_at"],
            "generationReason": run["generation_reason"],
            "modelName": run["model_name"],
            "candidateCount": int(run["candidate_count"]),
            "candidates": [
                {
                    "candidateId": row["candidate_id"],
                    "semanticScore": float(row["semantic_score"]),
                    "rank": int(row["rank"]),
                    "generatedAt": row["generated_at"],
                }
                for row in rows
            ],
        }

    def list_pending_outbox_events(self, limit: int = 100) -> list[dict[str, Any]]:
        resolved_limit = max(1, int(limit))
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, topic, event_type, payload_json, created_at
                FROM outbox_events
                WHERE processed = 0
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (resolved_limit,),
            ).fetchall()

        return [
            {
                "id": row["id"],
                "topic": row["topic"],
                "eventType": row["event_type"],
                "payload": json.loads(row["payload_json"]),
                "createdAt": row["created_at"],
            }
            for row in rows
        ]

    def lock_outbox_event(self, event_id: str) -> bool:
        with self._lock, self._connect() as connection:
            result = connection.execute(
                """
                UPDATE outbox_events
                SET processed = 1
                WHERE id = ? AND processed = 0
                """,
                (event_id,),
            )
            connection.commit()
            return result.rowcount == 1

    def reset_outbox_event(self, event_id: str):
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                UPDATE outbox_events
                SET processed = 0
                WHERE id = ?
                """,
                (event_id,),
            )
            connection.commit()

    def get_outbox_event(self, event_id: str) -> dict[str, Any] | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, topic, event_type, payload_json, processed, created_at
                FROM outbox_events
                WHERE id = ?
                """,
                (event_id,),
            ).fetchone()

        if row is None:
            return None

        return {
            "id": row["id"],
            "topic": row["topic"],
            "eventType": row["event_type"],
            "payload": json.loads(row["payload_json"]),
            "processed": bool(row["processed"]),
            "createdAt": row["created_at"],
        }

    def _insert_outbox_event(
        self,
        connection: sqlite3.Connection,
        topic: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> str:
        outbox_id = str(uuid4())
        connection.execute(
            """
            INSERT INTO outbox_events (
                id,
                topic,
                event_type,
                payload_json,
                processed,
                created_at
            ) VALUES (?, ?, ?, ?, 0, ?)
            """,
            (
                outbox_id,
                topic,
                event_type,
                json.dumps(payload),
                self._now_iso(),
            ),
        )
        return outbox_id

    def _connect(self):
        connection = sqlite3.connect(self._db_path, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        return connection

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()
