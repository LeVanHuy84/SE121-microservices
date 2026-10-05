import unittest
from unittest.mock import MagicMock, patch
import numpy as np

from app.modules.analysis.services.ml_models.text_moderation.phobert_moderator import PhoBERTModerator


class TestPhoBERTModeratorLongText(unittest.TestCase):
    def setUp(self):
        self.moderator = PhoBERTModerator()
        self.moderator.initialized = True
        self.moderator.tokenizer = MagicMock()
        self.moderator.session = MagicMock()

    def test_empty_text_returns_clean(self):
        result = self.moderator.infer("")
        self.assertTrue(result["available"])
        self.assertEqual(result["predicted_label"], "CLEAN")
        self.assertEqual(result["model"], "phobert_empty_text")

    @patch("app.modules.analysis.services.ml_models.text_emotion.text_preprocessor.split_sentences")
    @patch("app.modules.analysis.services.ml_models.text_emotion.text_preprocessor.preprocess_single_sentence")
    def test_long_text_max_severity_aggregation(self, mock_prep, mock_split):
        # Setup 3 sentences:
        # Sentence 1 & 2 are CLEAN
        # Sentence 3 (at the end of long text) is HATE_SPEECH
        mock_split.return_value = [
            "Hôm nay trời rất đẹp và tôi đi dạo công viên.",
            "Tôi ăn một bát phở rất ngon ở quán quen.",
            "Thằng này ngu ngốc thật sự tao ghét nó vãi."
        ]
        mock_prep.side_effect = lambda s, **kw: s

        fake_inputs = {
            "input_ids": np.ones((3, 10), dtype=np.int64),
            "attention_mask": np.ones((3, 10), dtype=np.int64)
        }
        self.moderator.tokenizer.return_value = fake_inputs

        # Mock ONNX Session output logits for 3 sentences:
        fake_logits = np.array([
            [2.0, -1.0, -1.5, -2.0],
            [3.0, -2.0, -2.0, -3.0],
            [-2.0, -2.0, 2.5, -2.0]
        ], dtype=np.float32)
        
        self.moderator.session.run.return_value = [fake_logits]

        result = self.moderator.infer("Dài hơn 300 từ...")

        self.assertTrue(result["available"])
        self.assertEqual(result["predicted_label"], "HATE_SPEECH")
        self.assertEqual(result["predicted_class_id"], 2)
        self.assertEqual(result["model"], "phobert_multiclass_longtext")
        self.assertGreater(result["all_scores"]["HATE_SPEECH"], 0.8)


if __name__ == "__main__":
    unittest.main()
