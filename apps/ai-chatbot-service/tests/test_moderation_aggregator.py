import unittest
from unittest.mock import MagicMock

from app.modules.analysis.services.ml_models.text_moderation.moderation_aggregator import ModerationAggregator


class TestModerationAggregatorThreshold(unittest.TestCase):
    def setUp(self):
        self.mock_phobert = MagicMock()
        self.mock_keyword = MagicMock()
        self.mock_keyword.analyze.return_value = {"blocked": False}
        self.aggregator = ModerationAggregator(
            phobert=self.mock_phobert,
            keyword=self.mock_keyword,
            hard_block_threshold=0.80
        )

    def test_hate_speech_below_threshold_returns_warning(self):
        self.mock_phobert.infer.return_value = {
            "available": True,
            "predicted_label": "HATE_SPEECH",
            "predicted_class_id": 2,
            "confidence": 0.5659,
            "all_scores": {
                "CLEAN": 0.0654,
                "PROFANITY_VENTING": 0.4559,
                "HATE_SPEECH": 0.5659,
                "EMOTIONAL_CRISIS": 0.0047
            },
            "model": "phobert_multiclass"
        }

        result = self.aggregator.moderate("Dm th sv trong nhóm...")

        self.assertFalse(result["isViolation"])
        self.assertEqual(result["action"], "ALLOW_WITH_WARNING")
        self.assertEqual(result["label"], "HATE_SPEECH")
        self.assertEqual(result["confidence"], 0.5659)

    def test_hate_speech_above_threshold_returns_hard_block(self):
        self.mock_phobert.infer.return_value = {
            "available": True,
            "predicted_label": "HATE_SPEECH",
            "predicted_class_id": 2,
            "confidence": 0.88,
            "all_scores": {
                "CLEAN": 0.01,
                "PROFANITY_VENTING": 0.11,
                "HATE_SPEECH": 0.88,
                "EMOTIONAL_CRISIS": 0.0
            },
            "model": "phobert_multiclass"
        }

        result = self.aggregator.moderate("Thằng này ngu ngốc...")

        self.assertTrue(result["isViolation"])
        self.assertEqual(result["action"], "HARD_BLOCK")
        self.assertEqual(result["label"], "HATE_SPEECH")
        self.assertEqual(result["confidence"], 0.88)


if __name__ == "__main__":
    unittest.main()
