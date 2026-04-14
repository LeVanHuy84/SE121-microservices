import unittest

from app.database.recommendation_state_repository import RecommendationStateRepository
from app.processors.recommendation_state_processor import RecommendationStateProcessor
from app.services.global_fallback_batch_service import GlobalFallbackBatchService


class RecommendationStateProcessorTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_run_once_refreshes_global_fallback_summary(self):
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
                processor = RecommendationStateProcessor(
                    GlobalFallbackBatchService(repository),
                )
                await processor.run_once()

                summary = processor.get_last_summary()
                fallback_candidates = repository.list_global_fallback_candidates(
                    offset=0,
                    limit=10,
                )
                self.assertIsNotNone(summary)
                self.assertTrue(summary["globalFallbackRefreshed"])
                self.assertEqual(summary["globalFallbackRefreshCount"], 2)
                self.assertEqual(len(fallback_candidates), 2)
            finally:
                repository.close()


if __name__ == "__main__":
    unittest.main()
