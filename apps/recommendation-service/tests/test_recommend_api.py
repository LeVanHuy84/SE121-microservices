import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.api.recommend_api import (
    get_query_cache_stats,
    query_candidates,
)
from app.models.rerank_request import (
    RecommendationQueryRequest,
)


class RecommendationApiTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_query_candidates_returns_query_contract_payload(self):
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
            response = await query_candidates(request)

        self.assertTrue(response["success"])
        self.assertEqual(response["data"].viewerId, "viewer-1")
        self.assertEqual(response["data"].source, "semantic_online")
        self.assertEqual(response["data"].candidates[0].candidateId, "candidate-1")
        self.assertEqual(response["data"].candidates[0].finalScore, 0.694)
        query.assert_called_once_with(request)

    def test_get_query_cache_stats_returns_cache_metrics(self):
        with patch(
            "app.api.recommend_api.query_cache.get_stats",
            return_value={
                "backend": "redis",
                "ttlSeconds": 30.0,
                "redisHost": "localhost",
                "redisPort": 6379,
                "redisDb": 0,
                "maxEntries": 1000,
                "entryCount": 1,
                "viewerCount": 1,
                "hits": 2,
                "misses": 3,
                "sets": 1,
                "evictions": 0,
                "invalidations": 1,
                "clears": 0,
                "errors": 0,
            },
        ) as get_stats:
            response = get_query_cache_stats()

        self.assertTrue(response["success"])
        self.assertEqual(response["data"]["backend"], "redis")
        self.assertEqual(response["data"]["entryCount"], 1)
        self.assertEqual(response["data"]["hits"], 2)
        get_stats.assert_called_once_with()

    async def test_query_candidates_raises_bad_request_for_invalid_cursor(self):
        request = RecommendationQueryRequest(
            viewerId="viewer-1",
            limit=3,
        )

        with patch(
            "app.api.recommend_api.recommendation_query_service.query",
            side_effect=ValueError("Invalid cursor"),
        ):
            with self.assertRaises(HTTPException) as context:
                await query_candidates(request)

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(context.exception.detail, "Invalid cursor")


if __name__ == "__main__":
    unittest.main()
