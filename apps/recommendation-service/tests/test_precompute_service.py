import tempfile
import unittest
from pathlib import Path

from app.database.recommendation_state_repository import RecommendationStateRepository
from app.services.graph_state_store import RecommendationGraphStateStore
from app.services.precompute_service import RecommendationPrecomputeService


class RecommendationPrecomputeServiceTestCase(unittest.TestCase):
    def test_compute_for_viewer_writes_sorted_snapshot_and_filters_blocked(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repository = RecommendationStateRepository(
                f"sqlite+pysqlite:///{Path(temp_dir) / 'recommendation-state.sqlite3'}"
            )
            try:
                repository.create_schema()
                local_graph_state_store = RecommendationGraphStateStore()
                local_graph_state_store.apply_user_blocked("viewer-1", "candidate-c")
                service = RecommendationPrecomputeService(
                    repository,
                    local_graph_state_store,
                )

                repository.upsert_profile_embedding(
                    "viewer-1",
                    "viewer",
                    [1.0, 0.0],
                    "demo-model",
                    "2026-04-10T00:00:00+00:00",
                )
                repository.upsert_profile_embedding(
                    "candidate-a",
                    "a",
                    [0.9, 0.0],
                    "demo-model",
                    "2026-04-10T00:00:00+00:00",
                )
                repository.upsert_profile_embedding(
                    "candidate-b",
                    "b",
                    [0.7, 0.0],
                    "demo-model",
                    "2026-04-10T00:00:00+00:00",
                )
                repository.upsert_profile_embedding(
                    "candidate-c",
                    "c",
                    [0.8, 0.0],
                    "demo-model",
                    "2026-04-10T00:00:00+00:00",
                )

                result = service.compute_for_viewer(
                    "viewer-1",
                    generation_reason="unit-test",
                )

                snapshot = repository.get_precomputed_snapshot("viewer-1", 10)

                self.assertEqual(result["candidateCount"], 2)
                self.assertEqual(
                    [candidate["candidateId"] for candidate in snapshot["candidates"]],
                    ["candidate-a", "candidate-b"],
                )
            finally:
                repository.close()
