from motor.motor_asyncio import AsyncIOMotorCollection
from bson import ObjectId
from typing import Optional, List
from datetime import datetime


class AnalysisRepository:
    def __init__(self, collection: AsyncIOMotorCollection):
        self.collection = collection

    async def save_analysis(self, data: dict) -> dict:
        """Insert new emotion aggregate. Accepts dict, returns dict with _id."""
        result = await self.collection.insert_one(data)
        data["_id"] = str(result.inserted_id)
        return data

    async def get_analysis_by_id(self, analysisId: str) -> Optional[dict]:
        """Get emotion aggregate by ID."""
        try:
            obj_id = ObjectId(analysisId)
        except Exception:
            return None
        
        doc = await self.collection.find_one({"_id": obj_id})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    async def get_analysis_by_target(self, targetId: str, targetType: str) -> Optional[dict]:
        """Get emotion aggregate by target ID and type."""
        doc = await self.collection.find_one({
            "targetId": targetId,
            "targetType": targetType
        })
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc
    

    async def update_analysis(self, analysisId: str, update_data: dict) -> Optional[dict]:
        """Update emotion aggregate by ID."""
        try:
            obj_id = ObjectId(analysisId) if isinstance(analysisId, str) else analysisId
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

    # NEW: Get limit
    async def get_history(
        self,
        user_id: str,
        start: datetime,
        end: datetime,
        cursor: datetime | None = None,
        limit: int = 20
    ) -> List[dict]:
        """Get paginated history with date range filter."""
        query = {
            "userId": user_id,
            "createdAtVN": {
                "$gte": start,
                "$lte": end
            }
        }

        if cursor:
            query["createdAtVN"]["$lt"] = cursor

        cursor_obj = self.collection.find(query).sort("createdAtVN", -1).limit(limit)
        docs = await cursor_obj.to_list(length=limit)
        
        for doc in docs:
            doc["_id"] = str(doc["_id"])
        return docs



    # NEW: filter by date range
    async def get_analysis_by_date_range(self, user_id: str, from_date: datetime, to_date: datetime) -> List[dict]:
        """Get all analyses in date range."""
        query = {
            "userId": user_id,
            "createdAtVN": {
                "$gte": from_date,
                "$lte": to_date
            }
        }
        
        cursor = self.collection.find(query)
        docs = await cursor.to_list(length=None)
        
        for doc in docs:
            doc["_id"] = str(doc["_id"])
        return docs

    # NEW: get successful entries for summary
    async def get_all_for_summary(self, user_id: str, start: datetime, end: datetime) -> List[dict]:
        """Get all analyses for summary in date range."""
        query = {
            "userId": user_id,
            "createdAtVN": {
                "$gte": start,
                "$lte": end
            }
        }
        
        cursor = self.collection.find(query)
        docs = await cursor.to_list(length=None)
        
        for doc in docs:
            doc["_id"] = str(doc["_id"])
        return docs
    
    async def get_user_recent_analyses(self, user_id: str, limit: int = 30) -> List[dict]:
        """Get recent analyses for user."""
        query = {"userId": user_id}
        
        cursor = self.collection.find(query).sort("createdAt", -1).limit(limit)
        docs = await cursor.to_list(length=limit)
        
        for doc in docs:
            doc["_id"] = str(doc["_id"])
        return docs

