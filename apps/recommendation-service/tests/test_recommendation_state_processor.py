import unittest

from app.services.precompute_queue import RecommendationPrecomputeQueue
from app.services.precompute_service import RecommendationPrecomputeService
from app.processors.recommendation_state_processor import RecommendationStateProcessor
from app.services.graph_state_store import RecommendationGraphStateStore
from app.database.recommendation_state_repository import RecommendationStateRepository


class RecommendationStateProcessorTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_run_once_updates_last_summary(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as temp_dir:
            repository = RecommendationStateRepository(
                str(Path(temp_dir) / "recommendation-state.sqlite3")
            )
            repository.ensure_schema()
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
            processor = RecommendationStateProcessor(
                queue,
                RecommendationPrecomputeService(repository),
            )
            store = RecommendationGraphStateStore()

            import app.processors.recommendation_state_processor as processor_module

            original_store = processor_module.graph_state_store
            processor_module.graph_state_store = store

            try:
                await processor.run_once()
            finally:
                processor_module.graph_state_store = original_store

            summary = processor.get_last_summary()
            snapshot = repository.get_precomputed_snapshot("user-1", 10)
            self.assertIsNotNone(summary)
            self.assertEqual(summary["processedViewers"], 1)
            self.assertEqual(snapshot["candidateCount"], 1)


if __name__ == "__main__":
    unittest.main()
