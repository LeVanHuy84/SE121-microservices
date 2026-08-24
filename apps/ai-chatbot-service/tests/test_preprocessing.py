import unittest

from app.utils.teencode.teencode_normalizer import teencode_normalizer
from app.utils.text_cleaner.social_text_cleaner import social_text_cleaner
from app.modules.analysis.services.ml_models.text_emotion.text_preprocessor import normalize_text


class TestPhoBERTPreprocessingPipeline(unittest.TestCase):

    def test_teencode_normalizer(self):
        text = "em k thik dede nay dau, wk j ma ghet vay"
        result = teencode_normalizer.normalize(text)
        self.assertIn("không", result)
        self.assertIn("thích", result)
        self.assertIn("dear", result)
        self.assertIn("biết", result)
        self.assertIn("gì", result)
        self.assertIn("ghét", result)

    def test_social_text_cleaner(self):
        text = "Ghé xem https://example.com nè @user #happy_day"
        result = social_text_cleaner.clean(text)
        self.assertNotIn("https://example.com", result)
        self.assertNotIn("@user", result)
        self.assertIn("happy_day", result)

    def test_phobert_text_preprocessor(self):
        raw = "em k thik dede nay dau, wk j ma ghet vay =(((( 😂"
        res = normalize_text(raw)
        self.assertTrue(res["hasEmoji"])
        processed = res["text"]
        self.assertIn("không", processed)
        self.assertIn("thích", processed)
        self.assertIn("buồn", processed)
        self.assertIn("vui", processed)


if __name__ == "__main__":
    unittest.main()
