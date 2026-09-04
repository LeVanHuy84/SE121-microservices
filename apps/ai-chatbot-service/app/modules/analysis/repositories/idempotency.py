import logging
from datetime import datetime, timezone
from typing import List, Set
from motor.motor_asyncio import AsyncIOMotorCollection
from pymongo.errors import DuplicateKeyError

logger = logging.getLogger(__name__)


class IdempotencyRepository:
    """
    Idempotency Repository using MongoDB processed_events collection.
    Status values: 'PROCESSING' | 'DONE' | 'FAILED'
    Compatible with NestJS MongoProcessedEvent schema in @repo/common.
    """

    def __init__(self, collection: AsyncIOMotorCollection):
        self.collection = collection

    async def filter_unprocessed_event_ids(self, event_ids: List[str]) -> Set[str]:
        """
        Bulk check list of event_ids in MongoDB.
        Returns a set of event_ids that have NOT been processed yet (or are not in DONE/PROCESSING state).
        """
        if not event_ids:
            return set()

        cursor = self.collection.find(
            {"_id": {"$in": event_ids}},
            {"_id": 1, "status": 1}
        )
        existing_docs = await cursor.to_list(length=len(event_ids))
        
        existing_ids = {doc["_id"] for doc in existing_docs if doc.get("status") in ("DONE", "PROCESSING")}
        
        unprocessed = {eid for eid in event_ids if eid not in existing_ids}
        return unprocessed

    async def try_acquire(self, event_id: str) -> bool:
        """
        Try to acquire lock for a single event_id by inserting with status='PROCESSING'.
        Returns True if acquired successfully, False if already exists (duplicate).
        """
        if not event_id:
            return True

        doc = {
            "_id": event_id,
            "status": "PROCESSING",
            "updatedAt": datetime.now(timezone.utc)
        }
        try:
            await self.collection.insert_one(doc)
            return True
        except DuplicateKeyError:
            logger.info("[Idempotency] Event %s already acquired or processed -> Skip", event_id)
            return False

    async def mark_done(self, event_id: str):
        """Mark event_id as DONE."""
        if not event_id:
            return
        await self.collection.update_one(
            {"_id": event_id},
            {"$set": {"status": "DONE", "updatedAt": datetime.now(timezone.utc)}},
            upsert=True
        )

    async def mark_failed(self, event_id: str, reason: str = ""):
        """Mark event_id as FAILED."""
        if not event_id:
            return
        await self.collection.update_one(
            {"_id": event_id},
            {"$set": {"status": "FAILED", "reason": reason, "updatedAt": datetime.now(timezone.utc)}},
            upsert=True
        )
