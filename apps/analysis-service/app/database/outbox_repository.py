from odmantic import AIOEngine
from bson import ObjectId
from typing import List
from app.database.models.outbox_schema import Outbox

class OutboxRepository:
    def __init__(self, engine: AIOEngine):
        self.engine = engine

    async def save_outbox(self, data: Outbox):
        return await self.engine.save(data)

    async def get_outbox_by_id(self, outbox_id: str):
        return await self.engine.find_one(Outbox, Outbox.id == ObjectId(outbox_id))

    async def get_pending_outboxes(self, limit: int = 200):
        return await self.engine.find(
            Outbox,
            Outbox.processed == False,
            sort=Outbox.createdAt,
            limit=limit
        )

    async def mark_outbox_as_processed(self, outbox_id: str):
        outbox = await self.get_outbox_by_id(outbox_id)
        if not outbox:
            return None

        outbox.processed = True
        return await self.engine.save(outbox)

    # ============= NEW: BULK UPDATE =============
    async def mark_many_processed(self, ids: List[ObjectId]):
        """Set processed = True for multiple events"""
        outboxes = await self.engine.find(
            Outbox, Outbox.id.in_(ids)
        )

        for o in outboxes:
            o.processed = True

        await self.engine.save_all(outboxes)
        return len(outboxes)
