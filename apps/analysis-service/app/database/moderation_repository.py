from odmantic import AIOEngine
from bson import ObjectId
from typing import Optional

from app.database.schemas.moderation_result import ModerationResult
from app.enums.event_enum import TargetTypeEnum


class ModerationRepository:
    """Repository for ModerationResult persistence."""

    def __init__(self, engine: AIOEngine):
        self.engine = engine

    # ======================================================
    # SAVE
    # ======================================================
    async def save_moderation(self, data: ModerationResult):
        return await self.engine.save(data)


    # ======================================================
    # GET BY ID
    # ======================================================
    async def get_by_id(self, moderation_id: str) -> Optional[ModerationResult]:
        try:
            obj_id = ObjectId(moderation_id)
        except Exception:
            return None

        return await self.engine.find_one(
            ModerationResult,
            ModerationResult.id == obj_id
        )

    # ======================================================
    # GET BY TARGET
    # ======================================================
    async def get_by_target(
        self,
        target_id: str,
        target_type: TargetTypeEnum
    ) -> Optional[ModerationResult]:

        return await self.engine.find_one(
            ModerationResult,
            (ModerationResult.targetId == target_id) &
            (ModerationResult.targetType == target_type)
        )

    # ======================================================
    # UPDATE
    # ======================================================
    async def update_moderation(
        self,
        moderation_id: str,
        update_data: dict
    ) -> Optional[ModerationResult]:

        try:
            obj_id = (
                ObjectId(moderation_id)
                if isinstance(moderation_id, str)
                else moderation_id
            )
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

        # ⚠️ rebuild lại model trước khi save
        moderation = ModerationResult.model_validate(
            moderation.model_dump(mode="python", by_alias=True)
        )

        return await self.engine.save(moderation)
