from motor.motor_asyncio import AsyncIOMotorCollection
from bson import ObjectId
from typing import Optional

from app.enums.event_enum import TargetTypeEnum


class ModerationRepository:
    """Repository for ModerationResult persistence."""

    def __init__(self, collection: AsyncIOMotorCollection):
        self.collection = collection

    # ======================================================
    # SAVE
    # ======================================================
    async def save_moderation(self, data: dict) -> dict:
        """Insert new moderation result. Accepts dict, returns dict with _id."""
        result = await self.collection.insert_one(data)
        data["_id"] = str(result.inserted_id)
        return data


    # ======================================================
    # GET BY ID
    # ======================================================
    async def get_by_id(self, moderation_id: str) -> Optional[dict]:
        """Get moderation result by ID."""
        try:
            obj_id = ObjectId(moderation_id)
        except Exception:
            return None

        doc = await self.collection.find_one({"_id": obj_id})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    # ======================================================
    # GET BY TARGET
    # ======================================================
    async def get_by_target(
        self,
        target_id: str,
        target_type: TargetTypeEnum
    ) -> Optional[dict]:
        """Get moderation result by target ID and type."""
        target_type_str = target_type.value if hasattr(target_type, 'value') else str(target_type)
        
        doc = await self.collection.find_one({
            "targetId": target_id,
            "targetType": target_type_str
        })
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    # ======================================================
    # UPDATE
    # ======================================================
    async def update_moderation(
        self,
        moderation_id: str,
        update_data: dict
    ) -> Optional[dict]:
        """Update moderation result by ID."""
        try:
            obj_id = (
                ObjectId(moderation_id)
                if isinstance(moderation_id, str)
                else moderation_id
            )
        except Exception:
            return None

        result = await self.collection.update_one(
            {"_id": obj_id},
            {"$set": update_data}
        )

        if result.matched_count == 0:
            return None

        # Return updated document
        doc = await self.collection.find_one({"_id": obj_id})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc
