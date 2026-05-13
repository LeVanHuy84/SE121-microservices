import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from app.database.recommendation_state_repository import RecommendationStateRepository
from app.messaging.emotion_profile_event_handler import EmotionProfileEventHandler


class EmotionProfileEventHandlerTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.repository = RecommendationStateRepository(
            f"sqlite+pysqlite:///{Path(self.temp_dir.name) / 'state.sqlite3'}"
        )
        self.repository.create_schema()
        self.handler = EmotionProfileEventHandler(self.repository)

    async def asyncTearDown(self):
        self.repository.close()
        self.temp_dir.cleanup()

    async def test_handle_emotion_event_upserts_profile(self):
        now = datetime.now(timezone.utc).isoformat()
        await self.handler.handle(
            {
                "type": "recommendation.emotion.profile-updated",
                "payload": {
                    "userId": "user-1",
                    "riskScore": 0.42,
                    "recentNegativityScore": 0.31,
                    "dominantEmotion": "joy",
                    "finalScores": {"joy": 0.8, "sadness": 0.2},
                    "occurredAt": now,
                },
            }
        )

        profiles = self.repository.get_emotion_profiles(["user-1"])
        self.assertIn("user-1", profiles)
        self.assertAlmostEqual(profiles["user-1"]["riskScore"], 0.42, places=3)
        self.assertAlmostEqual(
            profiles["user-1"]["recentNegativityScore"], 0.31, places=3
        )
        self.assertEqual(profiles["user-1"]["dominantEmotion"], "joy")


if __name__ == "__main__":
    unittest.main()
