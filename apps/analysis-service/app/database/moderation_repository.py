from odmantic import AIOEngine
from bson import ObjectId
from typing import Optional
from app.database.schemas.moderation_result import ModerationResult
from app.enums.event_enum import TargetTypeEnum


class ModerationRepository:
    """Repository for ModerationResult persistence."""
    
    def __init__(self, engine: AIOEngine):
        self.engine = engine

    async def save_moderation(self, data: ModerationResult) -> ModerationResult:
        """Save moderation result."""
        return await self.engine.save(data)
    
    async def save_moderation_raw(self, data: ModerationResult) -> ModerationResult:
        """Save moderation result using raw MongoDB insert to bypass ODMantic bug."""
        # Convert model to dict using model_dump()
        doc = data.model_dump()
        
        # Remove 'id' if it's None to let MongoDB generate it
        if 'id' in doc and doc['id'] is None:
            del doc['id']
        
        # Insert directly into MongoDB collection
        collection = self.engine.get_collection(ModerationResult)
        result = await collection.insert_one(doc)
        
        # Fetch the inserted document back to get the proper model with ID
        inserted_doc = await collection.find_one({"_id": result.inserted_id})
        
        # Map MongoDB _id to ODMantic id field
        if inserted_doc and '_id' in inserted_doc:
            inserted_doc['id'] = inserted_doc.pop('_id')
        
        # Create new model instance from the inserted document
        return ModerationResult.model_validate(inserted_doc)

    async def get_by_id(self, moderation_id: str) -> Optional[ModerationResult]:
        """Get moderation result by ID."""
        try:
            obj_id = ObjectId(moderation_id)
        except:
            return None
        return await self.engine.find_one(
            ModerationResult,
            ModerationResult.id == obj_id
        )

    async def get_by_target(
        self,
        target_id: str,
        target_type: TargetTypeEnum
    ) -> Optional[ModerationResult]:
        """Get moderation result by target."""
        return await self.engine.find_one(
            ModerationResult,
            (ModerationResult.targetId == target_id) &
            (ModerationResult.targetType == target_type)
        )

    async def update_moderation(
        self,
        moderation_id: str,
        update_data: dict
    ) -> Optional[ModerationResult]:
        """Update existing moderation result."""
        try:
            obj_id = ObjectId(moderation_id) if isinstance(moderation_id, str) else moderation_id
        except Exception:
            return None

        moderation = await self.engine.find_one(
            ModerationResult,
            ModerationResult.id == obj_id
        )

        if not moderation:
            return None

        for key, value in update_data.items():
            if hasattr(moderation, key):
                setattr(moderation, key, value)

        return await self.engine.save(moderation)
