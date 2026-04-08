import unittest

from fastapi import HTTPException

from app.core.security import verify_internal_key
from app.core.config import settings


class RecommendationSecurityTestCase(unittest.TestCase):
    def test_verify_internal_key_accepts_matching_value(self):
        self.assertIsNone(verify_internal_key(settings.INTERNAL_SERVICE_KEY))

    def test_verify_internal_key_rejects_invalid_value(self):
        with self.assertRaises(HTTPException) as context:
            verify_internal_key("invalid-key")

        self.assertEqual(context.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
