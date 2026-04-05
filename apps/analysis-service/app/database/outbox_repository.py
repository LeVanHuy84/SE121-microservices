from motor.motor_asyncio import AsyncIOMotorCollection
from bson import ObjectId
from typing import List, Optional


class OutboxRepository:
    def __init__(self, collection: AsyncIOMotorCollection):
        self.collection = collection

    async def save_outbox(self, data: dict) -> dict:
        """Insert new outbox event. Accepts dict, returns dict with _id."""
        result = await self.collection.insert_one(data)
        data["_id"] = str(result.inserted_id)
        return data

    async def get_outbox_by_id(self, outbox_id: str) -> Optional[dict]:
        """Get outbox event by ID."""
        try:
            obj_id = ObjectId(outbox_id)
        except Exception:
            return None
        
        doc = await self.collection.find_one({"_id": obj_id})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    async def get_pending_outboxes(self, limit: int = 200) -> List[dict]:
        """Get pending (unprocessed) outbox events."""
        query = {"processed": False}
        
        cursor = self.collection.find(query).sort("createdAt", 1).limit(limit)
        docs = await cursor.to_list(length=limit)
        
        for doc in docs:
            doc["_id"] = str(doc["_id"])
        return docs

    async def mark_outbox_as_processed(self, outbox_id: str) -> Optional[dict]:
        """Mark a single outbox event as processed."""
        try:
            obj_id = ObjectId(outbox_id)
        except Exception:
            return None

        result = await self.collection.update_one(
            {"_id": obj_id},
            {"$set": {"processed": True}}
        )

        if result.matched_count == 0:
            return None

        # Return updated document
        doc = await self.collection.find_one({"_id": obj_id})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    # ============= NEW: BULK UPDATE =============
    async def mark_many_processed(self, ids: List[str]) -> int:
        """Set processed = True for multiple events."""
        # Convert string IDs to ObjectId
        obj_ids = []
        for id_str in ids:
            try:
                obj_ids.append(ObjectId(id_str))
            except Exception:
                continue
        
        if not obj_ids:
            return 0

        result = await self.collection.update_many(
            {"_id": {"$in": obj_ids}},
            {"$set": {"processed": True}}
        )

        return result.modified_count
