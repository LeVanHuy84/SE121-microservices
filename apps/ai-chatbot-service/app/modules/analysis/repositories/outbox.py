from motor.motor_asyncio import AsyncIOMotorCollection
from bson import ObjectId
from typing import List, Optional
from app.modules.analysis.enums import AnalysisStatusEnum, TargetTypeEnum

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

class TaskRepository:
    """Repository for AnalysisTask persistence (only failed tasks)."""

    def __init__(self, collection: AsyncIOMotorCollection):
        self.collection = collection

    async def save_task(self, data: dict) -> dict:
        """Insert new analysis task. Accepts dict, returns dict with _id."""
        result = await self.collection.insert_one(data)
        data["_id"] = str(result.inserted_id)
        return data

    async def get_by_id(self, task_id: str) -> Optional[dict]:
        """Get analysis task by ID."""
        try:
            obj_id = ObjectId(task_id)
        except Exception:
            return None

        doc = await self.collection.find_one({"_id": obj_id})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    async def get_by_target(
        self,
        target_id: str,
        target_type: TargetTypeEnum
    ) -> Optional[dict]:
        """Get analysis task by target ID and type."""
        target_type_str = target_type.value if hasattr(target_type, 'value') else str(target_type)
        
        doc = await self.collection.find_one({
            "targetId": target_id,
            "targetType": target_type_str
        })
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    async def update_task(
        self,
        task_id: str,
        update_data: dict
    ) -> Optional[dict]:
        """Update analysis task by ID."""
        try:
            obj_id = ObjectId(task_id) if isinstance(task_id, str) else task_id
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

    async def find_failed_tasks(self, max_retry: int) -> List[dict]:
        """Find all failed tasks below max retry count."""
        query = {
            "status": AnalysisStatusEnum.FAILED.value,
            "retryCount": {"$lt": max_retry}
        }
        
        cursor = self.collection.find(query)
        docs = await cursor.to_list(length=None)
        
        for doc in docs:
            doc["_id"] = str(doc["_id"])
        return docs

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
