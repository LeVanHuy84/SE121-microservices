import unittest

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


if __name__ == "__main__":
    unittest.main()
