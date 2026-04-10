import unittest

from app.processors.recommendation_state_processor import RecommendationStateProcessor
from app.services.graph_state_store import RecommendationGraphStateStore


class RecommendationStateProcessorTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_run_once_updates_last_summary(self):
        processor = RecommendationStateProcessor()
        store = RecommendationGraphStateStore()
        store.apply_friend_request_sent("user-1", "user-2")

        import app.processors.recommendation_state_processor as processor_module

        original_store = processor_module.graph_state_store
        processor_module.graph_state_store = store

        try:
            await processor.run_once()
        finally:
            processor_module.graph_state_store = original_store

        summary = processor.get_last_summary()
        self.assertIsNotNone(summary)
        self.assertEqual(summary["pendingRequestEdges"], 1)


if __name__ == "__main__":
    unittest.main()
