from motor.motor_asyncio import AsyncIOMotorCollection
from bson import ObjectId
from typing import Optional, List
from datetime import datetime
from app.enums.emotion_enum import EmotionTimeWindowEnum


class UserEmotionSnapshotRepository:
    """
    Repository for UserEmotionSnapshot collection.
    Handles persistence of time-windowed emotion snapshots (24h, 7d, 30d).
    
    ARCHITECTURE:
    - Each user has exactly ONE snapshot per time window
    - Unique key: (userId, window)
    - Snapshots represent CURRENT emotional state, not historical records
    - Each update overwrites the previous snapshot for that window
    
    MONGODB INDEX:
    Required unique index:
        db.user_emotion_snapshots.createIndex(
            { userId: 1, window: 1 },
            { unique: true }
        )
    """

    def __init__(self, collection: AsyncIOMotorCollection):
        self.collection = collection

    async def get_by_user_and_window(
        self,
        user_id: str,
        window: EmotionTimeWindowEnum
    ) -> Optional[dict]:
        """
        Get snapshot by user ID and window type.
        
        Returns the current snapshot for the specified window.
        Since each user has only one snapshot per window, this returns
        the most recent computation.
        """
        doc = await self.collection.find_one({
            "userId": user_id,
            "window": window.value
        })
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    async def get_latest_by_user_and_window(
        self,
        user_id: str,
        window: EmotionTimeWindowEnum
    ) -> Optional[dict]:
        """
        Get latest snapshot for a user and window type.
        
        Alias for get_by_user_and_window (since there's only one snapshot per window).
        Kept for backward compatibility.
        """
        return await self.get_by_user_and_window(user_id, window)

    async def get_all_by_user(self, user_id: str) -> List[dict]:
        """
        Get all snapshots for a user (all time windows).
        
        Returns at most 3 documents (24h, 7d, 30d).
        """
        cursor = self.collection.find({"userId": user_id}).sort("window", 1)
        docs = await cursor.to_list(length=None)
        for doc in docs:
            doc["_id"] = str(doc["_id"])
        return docs

    async def create(self, data: dict) -> dict:
        """
        Create new snapshot.
        
        Note: Prefer upsert() to avoid duplicate key errors.
        """
        result = await self.collection.insert_one(data)
        data["_id"] = str(result.inserted_id)
        return data

    async def upsert(
        self,
        user_id: str,
        window: EmotionTimeWindowEnum,
        data: dict
    ) -> dict:
        """
        Create or update snapshot for specific user and window.
        
        BEHAVIOR:
        - If snapshot exists: overwrites all fields with new data
        - If snapshot doesn't exist: creates new document
        - Unique constraint ensures only one snapshot per (userId, window)
        
        Args:
            user_id: User identifier
            window: Time window (24h, 7d, 30d)
            data: Complete snapshot data (must include computedAt)
            
        Returns:
            Updated snapshot document
        """
        result = await self.collection.update_one(
            {
                "userId": user_id,
                "window": window.value
            },
            {"$set": data},
            upsert=True
        )

        return await self.get_by_user_and_window(user_id, window)
