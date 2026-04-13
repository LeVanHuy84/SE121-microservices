import unittest
from unittest.mock import patch

from app.api.recommend_api import (
    query_candidates,
)
from app.models.rerank_request import (
    RecommendationQueryRequest,
)


class RecommendationApiTestCase(unittest.TestCase):
    def test_query_candidates_returns_query_contract_payload(self):
        request = RecommendationQueryRequest(
            viewerId="viewer-1",
            limit=3,
        )

        with patch(
            "app.api.recommend_api.recommendation_query_service.query",
            return_value={
                "viewerId": "viewer-1",
                "generatedAt": "2026-04-13T10:00:00+00:00",
                "source": "semantic_online",
                "scoreVersion": "recommendation-query-pipeline-v1",
                "candidateCount": 1,
                "nextCursor": None,
                "hasNextPage": False,
                "candidates": [
                    {
                        "candidateId": "candidate-1",
                        "source": "semantic_online",
                        "retrievalScore": 0.82,
                        "modelScore": 0.64,
                        "finalScore": 0.694,
                        "scoreVersion": "recommendation-query-pipeline-v1",
                        "reasonCodes": ["semantic_retrieval", "semantic_rerank"],
                        "rank": 1,
                    }
                ],
            },
        ) as query:
            response = query_candidates(request)

        self.assertTrue(response["success"])
        self.assertEqual(response["data"].viewerId, "viewer-1")
        self.assertEqual(response["data"].source, "semantic_online")
        self.assertEqual(response["data"].candidates[0].candidateId, "candidate-1")
        self.assertEqual(response["data"].candidates[0].finalScore, 0.694)
        query.assert_called_once_with(request)


if __name__ == "__main__":
    unittest.main()
