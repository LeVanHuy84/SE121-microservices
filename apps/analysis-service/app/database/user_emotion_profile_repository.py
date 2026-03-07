from motor.motor_asyncio import AsyncIOMotorCollection
from bson import ObjectId
from typing import Optional, Tuple
from datetime import datetime, timezone
import logging

logger = logging.getLogger(__name__)


class UserEmotionProfileRepository:
    """
    Repository for UserEmotionProfile collection.
    Handles persistence of user long-term emotion baseline and risk tracking.
    
    Includes idempotency and concurrency protection via:
    - lastProcessedAggregateId: Prevents duplicate aggregate processing
    - version: Optimistic locking for concurrent updates
    """

    def __init__(self, collection: AsyncIOMotorCollection):
        self.collection = collection

    async def get_by_user_id(self, user_id: str) -> Optional[dict]:
        """Get user emotion profile by user ID."""
        doc = await self.collection.find_one({"userId": user_id})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    async def create(self, data: dict) -> dict:
        """Create new user emotion profile."""
        if "version" not in data:
            data["version"] = 1
        if "lastProcessedAggregateId" not in data:
            data["lastProcessedAggregateId"] = None
            
        result = await self.collection.insert_one(data)
        data["_id"] = str(result.inserted_id)
        return data

    async def update(self, user_id: str, update_data: dict) -> Optional[dict]:
        """Update user emotion profile by user ID."""
        update_data["updatedAt"] = datetime.now(timezone.utc)
        
        result = await self.collection.update_one(
            {"userId": user_id},
            {"$set": update_data}
        )

        if result.matched_count == 0:
            return None

        return await self.get_by_user_id(user_id)

    async def update_with_idempotency(
        self,
        user_id: str,
        aggregate_id: str,
        update_data: dict,
        current_version: Optional[int] = None
    ) -> Tuple[bool, Optional[dict]]:
        """
        Idempotent update with optimistic locking.
        
        Prevents:
        1. Duplicate processing of same aggregate (via lastProcessedAggregateId)
        2. Lost updates from concurrent requests (via version)
        
        Strategy: Optimistic Locking with Version Field
        - Each update increments version
        - Update only succeeds if current version matches
        - If version mismatch → concurrent update occurred, retry needed
        
        Args:
            user_id: User identifier
            aggregate_id: Emotion aggregate ID being processed
            update_data: Fields to update
            current_version: Expected current version (for optimistic locking)
            
        Returns:
            Tuple of (success: bool, updated_doc: Optional[dict])
            - (False, None) if already processed or version conflict
            - (True, doc) if successfully updated
        """
        update_data["updatedAt"] = datetime.now(timezone.utc)
        update_data["lastProcessedAggregateId"] = aggregate_id
        
        # Build atomic update query
        # Condition: userId matches AND aggregate not yet processed AND version matches
        query = {
            "userId": user_id,
            "lastProcessedAggregateId": {"$ne": aggregate_id}  # Idempotency check
        }
        
        # Add version check if provided (optimistic locking)
        if current_version is not None:
            query["version"] = current_version
        
        # Atomic update with version increment
        update_operation = {
            "$set": update_data,
            "$inc": {"version": 1}
        }
        
        result = await self.collection.update_one(query, update_operation)
        
        if result.matched_count == 0:
            # Either already processed or version conflict
            existing = await self.get_by_user_id(user_id)
            
            if existing and existing.get("lastProcessedAggregateId") == aggregate_id:
                logger.info(
                    f"Aggregate {aggregate_id} already processed for user {user_id} - idempotent skip"
                )
                return (False, existing)
            
            if current_version is not None and existing:
                logger.warning(
                    f"Version conflict for user {user_id}: expected {current_version}, "
                    f"got {existing.get('version')} - concurrent update detected"
                )
            
            return (False, existing)
        
        # Successfully updated
        updated_doc = await self.get_by_user_id(user_id)
        return (True, updated_doc)

    async def upsert(self, user_id: str, data: dict) -> dict:
        """Create or update user emotion profile."""
        data["updatedAt"] = datetime.now(timezone.utc)
        
        if "version" not in data:
            data["version"] = 1
        if "lastProcessedAggregateId" not in data:
            data["lastProcessedAggregateId"] = None
        
        result = await self.collection.update_one(
            {"userId": user_id},
            {"$set": data},
            upsert=True
        )

        return await self.get_by_user_id(user_id)

    async def create_with_aggregate_id(self, data: dict, aggregate_id: str) -> dict:
        """
        Create initial profile for first aggregate.
        Sets lastProcessedAggregateId to prevent reprocessing.
        """
        data["version"] = 1
        data["lastProcessedAggregateId"] = aggregate_id
        data["updatedAt"] = datetime.now(timezone.utc)
        
        result = await self.collection.insert_one(data)
        data["_id"] = str(result.inserted_id)
        return data

    async def get_recently_updated_user_ids(
        self,
        since: datetime,
        limit: int = 1000
    ) -> list[str]:
        """
        Get user IDs that were updated since a given time.
        Used by batch processor to find users needing snapshot recomputation.
        
        Args:
            since: Only return users updated after this time
            limit: Maximum number of user IDs to return
            
        Returns:
            List of user IDs
        """
        cursor = self.collection.find(
            {"updatedAt": {"$gte": since}},
            {"userId": 1}
        ).limit(limit)
        
        docs = await cursor.to_list(length=limit)
        return [doc["userId"] for doc in docs]

    async def delete_by_user_id(self, user_id: str) -> bool:
        """Delete user emotion profile by user ID."""
        result = await self.collection.delete_one({"userId": user_id})
        return result.deleted_count > 0

