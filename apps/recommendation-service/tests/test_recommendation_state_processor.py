import unittest

from app.database.recommendation_state_repository import RecommendationStateRepository
from app.processors.recommendation_state_processor import RecommendationStateProcessor
from app.services.graph_state_store import RecommendationGraphStateStore
from app.services.precompute_queue import RecommendationPrecomputeQueue
from app.services.precompute_service import RecommendationPrecomputeService


class RecommendationStateProcessorTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_run_once_updates_last_summary(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as temp_dir:
            repository = RecommendationStateRepository(
                f"sqlite+pysqlite:///{Path(temp_dir) / 'recommendation-state.sqlite3'}"
            )
            try:
                repository.create_schema()
                repository.upsert_profile_embedding(
                    "user-1",
                    "viewer",
                    [1.0, 0.0],
                    "demo-model",
                    "2026-04-10T00:00:00+00:00",
                )
                repository.upsert_profile_embedding(
                    "user-2",
                    "candidate",
                    [0.9, 0.0],
                    "demo-model",
                    "2026-04-10T00:00:00+00:00",
                )
                queue = RecommendationPrecomputeQueue()
                queue.mark_stale("user-1")
                store = RecommendationGraphStateStore()
                processor = RecommendationStateProcessor(
                    queue,
                    RecommendationPrecomputeService(repository, store),
                    store,
                )
                await processor.run_once()

                summary = processor.get_last_summary()
                snapshot = repository.get_precomputed_snapshot("user-1", 10)
                self.assertIsNotNone(summary)
                self.assertEqual(summary["processedViewers"], 1)
                self.assertEqual(snapshot["candidateCount"], 1)
            finally:
                repository.close()


if __name__ == "__main__":
    unittest.main()
