import unittest
from unittest.mock import patch

from app.models.rerank_request import (
    RecommendationCandidateInput,
    RecommendationRerankRequest,
)
from app.services.rerank_service import RerankService


class RerankServiceTestCase(unittest.TestCase):
    def setUp(self):
        self.service = RerankService()

    def test_rerank_filters_invalid_candidates_and_dedupes_ids(self):
        request = RecommendationRerankRequest(
            viewerId="viewer-1",
            viewerProfileText="name: Viewer",
            candidates=[
                RecommendationCandidateInput(
                    candidateId="dup",
                    candidateProfileText="name: A",
                ),
                RecommendationCandidateInput(
                    candidateId="dup",
                    candidateProfileText="name: B",
                ),
                RecommendationCandidateInput(
                    candidateId="friend",
                    alreadyFriend=True,
                    candidateProfileText="name: Existing friend",
                ),
                RecommendationCandidateInput(
                    candidateId="blocked",
                    isBlocked=True,
                    candidateProfileText="name: Blocked",
                ),
            ],
        )

        with patch(
            "app.services.rerank_service.model_loader.predict_similarity_scores",
            return_value=[0.73],
        ) as predict_similarity_scores:
            result = self.service.rerank(request)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].candidateId, "dup")
        self.assertEqual(result[0].modelScore, 0.73)
        predict_similarity_scores.assert_called_once_with(
            "name: Viewer",
            ["name: A"],
        )

    def test_rerank_uses_override_score_before_model_prediction(self):
        request = RecommendationRerankRequest(
            viewerId="viewer-1",
            viewerProfileText="name: Viewer",
            candidates=[
                RecommendationCandidateInput(
                    candidateId="override",
                    similarityScore=0.85,
                ),
                RecommendationCandidateInput(
                    candidateId="predicted",
                    candidateProfileText="name: Candidate",
                ),
                RecommendationCandidateInput(
                    candidateId="missing-text",
                ),
            ],
        )

        with patch(
            "app.services.rerank_service.model_loader.predict_similarity_scores",
            return_value=[0.42],
        ) as predict_similarity_scores:
            result = self.service.rerank(request)

        self.assertEqual(
            [(item.candidateId, item.modelScore) for item in result],
            [
                ("override", 0.85),
                ("predicted", 0.42),
                ("missing-text", 0.0),
            ],
        )
        predict_similarity_scores.assert_called_once_with(
            "name: Viewer",
            ["name: Candidate"],
        )


if __name__ == "__main__":
    unittest.main()
