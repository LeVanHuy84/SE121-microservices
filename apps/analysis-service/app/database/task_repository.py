from motor.motor_asyncio import AsyncIOMotorCollection
from bson import ObjectId
from typing import Optional, List

from app.enums.analysis_status_enum import AnalysisStatusEnum
from app.enums.event_enum import TargetTypeEnum


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
