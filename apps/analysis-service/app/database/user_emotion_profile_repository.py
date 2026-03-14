from datetime import datetime, timezone
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorCollection


class UserEmotionProfileRepository:
    """Repository for daily user emotion profile persistence."""

    def __init__(self, collection: AsyncIOMotorCollection):
        self.collection = collection

    def _default_domain_baseline(self) -> dict:
        return {
            "joy": 0.0,
            "sadness": 0.0,
            "anger": 0.0,
            "fear": 0.0,
            "disgust": 0.0,
            "surprise": 0.0,
            "neutral": 0.0,
        }

    def _with_defaults(self, payload: dict) -> dict:
        enriched = dict(payload)
        enriched["negativeStreak"] = int(enriched.get("negativeStreak", 0))
        enriched["lastNegativeAt"] = enriched.get("lastNegativeAt")
        enriched["domainBaselineEmotion"] = enriched.get(
            "domainBaselineEmotion",
            self._default_domain_baseline(),
        )
        enriched["lastUpdated"] = enriched.get("lastUpdated", datetime.now(timezone.utc))
        return enriched

    async def get_by_user_id(self, user_id: str) -> Optional[dict]:
        doc = await self.collection.find_one({"userId": user_id})
        if doc:
            doc["_id"] = str(doc["_id"])
            doc = self._with_defaults(doc)
        return doc

    async def create(self, data: dict) -> dict:
        payload = self._with_defaults(data)
        result = await self.collection.insert_one(payload)
        payload["_id"] = str(result.inserted_id)
        return payload

    async def update(self, user_id: str, update_data: dict) -> Optional[dict]:
        payload = dict(update_data)
        payload["lastUpdated"] = payload.get("lastUpdated", datetime.now(timezone.utc))

        result = await self.collection.update_one({"userId": user_id}, {"$set": payload})
        if result.matched_count == 0:
            return None

        return await self.get_by_user_id(user_id)

    async def upsert(self, user_id: str, data: dict) -> dict:
        payload = dict(data)
        payload["userId"] = user_id
        payload["lastUpdated"] = payload.get("lastUpdated", datetime.now(timezone.utc))

        defaults_on_insert = {
            "negativeStreak": 0,
            "lastNegativeAt": None,
            "domainBaselineEmotion": self._default_domain_baseline(),
        }

        await self.collection.update_one(
            {"userId": user_id},
            {
                "$set": payload,
                "$setOnInsert": defaults_on_insert,
            },
            upsert=True,
        )
        return await self.get_by_user_id(user_id)

    async def delete_by_user_id(self, user_id: str) -> bool:
        result = await self.collection.delete_one({"userId": user_id})
        return result.deleted_count > 0
