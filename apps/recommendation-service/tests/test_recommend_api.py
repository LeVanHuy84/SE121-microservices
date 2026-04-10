import unittest
from unittest.mock import patch

from app.api.recommend_api import embed_profile_texts, get_precomputed_candidates
from app.models.rerank_request import RecommendationEmbeddingRequest


class RecommendationApiTestCase(unittest.TestCase):
    def test_embed_profile_texts_returns_embeddings_with_model_metadata(self):
        request = RecommendationEmbeddingRequest(
            items=[
                {
                    "entityId": "user-1",
                    "profileText": "name: An\nbio: backend engineer",
                },
                {
                    "entityId": "user-2",
                    "profileText": "",
                },
            ]
        )

        with patch(
            "app.api.recommend_api.model_loader.encode_profile_texts",
            return_value=[[0.1, 0.2], []],
        ) as encode_profile_texts, patch(
            "app.api.recommend_api.rerank_service.get_runtime_metadata",
            return_value={"modelName": "demo-model", "device": "cpu"},
        ):
            response = embed_profile_texts(request)

        self.assertTrue(response["success"])
        self.assertEqual(response["data"]["model"]["modelName"], "demo-model")
        self.assertEqual(
            [item.model_dump() for item in response["data"]["embeddings"]],
            [
                {"entityId": "user-1", "embedding": [0.1, 0.2]},
                {"entityId": "user-2", "embedding": []},
            ],
        )
        encode_profile_texts.assert_called_once_with(
            ["name: An\nbio: backend engineer", ""]
        )

    def test_get_precomputed_candidates_returns_snapshot_rows(self):
        with patch(
            "app.api.recommend_api.state_repository.get_precomputed_snapshot",
            return_value={
                "viewerId": "viewer-1",
                "generatedAt": "2026-04-10T00:01:00+00:00",
                "generationReason": "unit-test",
                "modelName": "demo-model",
                "candidateCount": 1,
                "candidates": [
                    {
                        "candidateId": "candidate-1",
                        "semanticScore": 0.95,
                        "rank": 1,
                        "generatedAt": "2026-04-10T00:01:00+00:00",
                    }
                ],
            },
        ):
            response = get_precomputed_candidates("viewer-1", 5)

        self.assertTrue(response["success"])
        self.assertEqual(response["data"]["viewerId"], "viewer-1")
        self.assertEqual(response["data"]["candidateCount"], 1)
        self.assertEqual(response["data"]["candidates"][0].candidateId, "candidate-1")


if __name__ == "__main__":
    unittest.main()
