import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.main import get_health_status, get_readiness_status


class RecommendationMainTestCase(unittest.TestCase):
    def test_health_endpoint_reports_service_alive(self):
        response = get_health_status()

        self.assertEqual(
            response,
            {
                "status": "ok",
                "service": "recommendation-service",
            },
        )

    def test_ready_endpoint_returns_status_when_model_ready(self):
        with patch(
            "app.main.model_loader.get_readiness_status",
            return_value={
                "ready": True,
                "modelName": "demo-model",
                "device": "cpu",
                "lastError": None,
            },
        ):
            response = get_readiness_status()

        self.assertEqual(response["status"], "ready")
        self.assertEqual(response["service"], "recommendation-service")
        self.assertEqual(response["model"]["modelName"], "demo-model")

    def test_ready_endpoint_returns_503_when_model_not_ready(self):
        with patch(
            "app.main.model_loader.get_readiness_status",
            return_value={
                "ready": False,
                "modelName": "demo-model",
                "device": "cpu",
                "lastError": "warmup failed",
            },
        ):
            with self.assertRaises(HTTPException) as context:
                get_readiness_status()

        self.assertEqual(context.exception.status_code, 503)
        self.assertEqual(context.exception.detail["lastError"], "warmup failed")


if __name__ == "__main__":
    unittest.main()
