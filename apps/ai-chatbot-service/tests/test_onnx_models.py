import unittest
from unittest.mock import MagicMock, patch
import numpy as np

from app.modules.analysis.services.ml_models.text_emotion.text_emotion_classifier import TextEmotionClassifier
from app.modules.analysis.services.ml_models.text_emotion.phobert_emotion_model import phobert_emotion_model
from app.modules.analysis.services.ml_models.text_moderation.phobert_moderator import PhoBERTModerator
from app.modules.analysis.services.ml_models.music.music_emotion_analyzer import MusicEmotionAnalyzer
from app.modules.analysis.services.ml_models.music.music_loader import music_model_loader


class TestONNXModels(unittest.TestCase):

    def test_phobert_moderator_onnx_inference(self):
        moderator = PhoBERTModerator()
        moderator.initialized = True
        moderator.tokenizer = MagicMock()
        moderator.session = MagicMock()

        fake_inputs = {
            "input_ids": np.ones((1, 8), dtype=np.int64),
            "attention_mask": np.ones((1, 8), dtype=np.int64)
        }
        moderator.tokenizer.return_value = fake_inputs

        # Clean sentence
        moderator.session.run.return_value = [
            np.array([[3.0, -1.0, -2.0, -3.0]], dtype=np.float32)
        ]

        result = moderator.infer("Chào bạn, chúc bạn một ngày tốt lành!")
        self.assertTrue(result["available"])
        self.assertEqual(result["predicted_label"], "CLEAN")
        self.assertEqual(result["predicted_class_id"], 0)

        # Emotional Crisis sentence
        moderator.session.run.return_value = [
            np.array([[-2.0, -1.0, -1.0, 4.0]], dtype=np.float32)
        ]
        res_crisis = moderator.infer("Tôi cảm thấy bế tắc và muốn kết thúc mọi thứ...")
        self.assertEqual(res_crisis["predicted_label"], "EMOTIONAL_CRISIS")
        self.assertEqual(res_crisis["predicted_class_id"], 3)

    @patch("app.modules.analysis.services.ml_models.text_emotion.text_emotion_classifier.detect_language")
    def test_phobert_emotion_onnx_inference(self, mock_lang):
        mock_lang.return_value = "vi"

        mock_tok = MagicMock()
        mock_tok.return_value = {
            "input_ids": np.ones((1, 8), dtype=np.int64),
            "attention_mask": np.ones((1, 8), dtype=np.int64)
        }

        mock_sess = MagicMock()
        # Logits corresponding to 7 labels: [Enjoyment, Sadness, Disgust, Anger, Fear, Surprise, Other]
        # Enjoyment is dominant
        mock_sess.run.return_value = [
            np.array([[4.0, -1.0, -2.0, -1.0, -2.0, -1.0, -1.0]], dtype=np.float32)
        ]

        with patch.object(phobert_emotion_model, "is_loaded", return_value=True), \
             patch.object(phobert_emotion_model, "get_tokenizer", return_value=mock_tok), \
             patch.object(phobert_emotion_model, "get_session", return_value=mock_sess):

            result = TextEmotionClassifier.classify("Hôm nay nhận được học bổng vui quá!")
            self.assertEqual(result["dominantEmotion"], "joy")
            self.assertEqual(result["primaryEmotion"], "joy")
            self.assertIn("joy", result["emotionScores"])
            self.assertGreater(result["confidence"], 0.8)

    @patch("app.modules.analysis.services.ml_models.music.music_emotion_analyzer.sf.read")
    @patch("app.modules.analysis.services.ml_models.music.music_emotion_analyzer.os.path.exists")
    def test_music_mert_onnx_inference(self, mock_exists, mock_sf_read):
        mock_exists.return_value = True
        # Fake 5 seconds of audio at 24000 Hz
        sample_audio = np.random.randn(24000 * 5).astype(np.float32)
        mock_sf_read.return_value = (sample_audio, 24000)

        mock_sess = MagicMock()
        mock_sess.run.return_value = [
            np.array([[0.82, 0.65]], dtype=np.float32)
        ]

        with patch.object(music_model_loader, "is_loaded", return_value=True), \
             patch.object(music_model_loader, "get_session", return_value=(mock_sess, "audio_waveform")):

            analyzer = MusicEmotionAnalyzer()
            result = analyzer.analyze("dummy_track.mp3")

            self.assertEqual(result["valence"], 0.82)
            self.assertEqual(result["arousal"], 0.65)


if __name__ == "__main__":
    unittest.main()
