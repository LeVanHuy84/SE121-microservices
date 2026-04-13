import unittest
from unittest.mock import patch

import torch

from app.core.config import settings
from app.services.model_loader import ModelLoader


class ModelLoaderTestCase(unittest.TestCase):
    def test_formats_e5_query_and_passage_inputs(self):
        loader = ModelLoader()
        original_model_name = settings.RECOMMENDATION_MODEL_NAME

        try:
            settings.RECOMMENDATION_MODEL_NAME = "intfloat/multilingual-e5-base"

            self.assertEqual(
                loader._format_query_text("name: An"),
                "query: name: An",
            )
            self.assertEqual(
                loader._format_candidate_text("bio: mobile engineer"),
                "passage: bio: mobile engineer",
            )
        finally:
            settings.RECOMMENDATION_MODEL_NAME = original_model_name

    def test_calibrates_cosine_score_into_zero_to_one_range(self):
        loader = ModelLoader()
        original_floor = settings.RECOMMENDATION_SCORE_FLOOR
        original_ceiling = settings.RECOMMENDATION_SCORE_CEILING

        try:
            settings.RECOMMENDATION_SCORE_FLOOR = 0.55
            settings.RECOMMENDATION_SCORE_CEILING = 0.9

            self.assertEqual(loader._calibrate_cosine_score(0.2), 0.0)
            self.assertEqual(loader._calibrate_cosine_score(0.95), 1.0)
            self.assertAlmostEqual(loader._calibrate_cosine_score(0.725), 0.5)
        finally:
            settings.RECOMMENDATION_SCORE_FLOOR = original_floor
            settings.RECOMMENDATION_SCORE_CEILING = original_ceiling

    def test_encode_profile_texts_preserves_input_order_and_blank_entries(self):
        loader = ModelLoader()

        with patch.object(
            loader,
            "_encode_texts",
            return_value=torch.tensor([[0.1, 0.2], [0.3, 0.4]], dtype=torch.float32),
        ) as encode_texts:
            result = loader.encode_profile_texts(["name: An", " ", "name: Binh"])

        self.assertEqual(result[1], [])
        self.assertAlmostEqual(result[0][0], 0.1, places=6)
        self.assertAlmostEqual(result[0][1], 0.2, places=6)
        self.assertAlmostEqual(result[2][0], 0.3, places=6)
        self.assertAlmostEqual(result[2][1], 0.4, places=6)
        encode_texts.assert_called_once_with(["name: An", "name: Binh"])

    def test_encode_profile_texts_deduplicates_identical_texts(self):
        loader = ModelLoader()

        with patch.object(
            loader,
            "_encode_texts",
            return_value=torch.tensor([[0.1, 0.2]], dtype=torch.float32),
        ) as encode_texts:
            result = loader.encode_profile_texts(["name: A", "name: A", ""])

        encode_texts.assert_called_once_with(["name: A"])
        self.assertEqual(result[2], [])
        self.assertAlmostEqual(result[0][0], 0.1, places=6)
        self.assertAlmostEqual(result[0][1], 0.2, places=6)
        self.assertAlmostEqual(result[1][0], 0.1, places=6)
        self.assertAlmostEqual(result[1][1], 0.2, places=6)


if __name__ == "__main__":
    unittest.main()
