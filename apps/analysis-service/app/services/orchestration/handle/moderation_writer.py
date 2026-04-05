import logging
from typing import List, Dict

from app.database.moderation_repository import ModerationRepository
from app.database.schemas.moderation_result import (
    ModerationResult,
    TextModerationResult,
    ImageModerationResult,
)
from app.enums.event_enum import TargetTypeEnum
from app.enums.moderation_enum import SeverityEnum

logger = logging.getLogger(__name__)


class ModerationWriter:

    def __init__(self, moderation_repo: ModerationRepository):
        self.moderation_repo = moderation_repo

    async def save_created(
        self,
        user_id: str,
        target_id: str,
        target_type: TargetTypeEnum,
        content: str,
        moderation_data: Dict
    ) -> dict:

        # ---- text result ----
        text_result = None
        if moderation_data.get("textResult"):
            t = moderation_data["textResult"]
            text_result = TextModerationResult(
                content=content,
                isViolation=t.get("isViolation", False),
                violationScore=t.get("violationScore", 0.0),
                source=t.get("source", "keyword"),
                sensitive=t.get("sensitive", False),
                flags=t.get("flags") or {},
            )

        # ---- image results ----
        image_results: List[ImageModerationResult] = []

        for img in moderation_data.get("imageResults", []):
            image_results.append(
                ImageModerationResult(
                    url=img.get("url", ""),
                    isViolation=img.get("isViolation", False),
                    violation=img.get("violation"),
                    severity=img.get("severity", SeverityEnum.NONE),
                    violationScore=img.get("violationScore"),
                    signalStrength=img.get("signalStrength"),
                    category=img.get("category"),
                    scores=img.get("scores"),
                )
            )

        moderation = ModerationResult(
            userId=user_id,
            targetId=target_id,
            targetType=target_type,  # truyền enum trực tiếp
            textResult=text_result,
            imageResults=image_results,
            isViolation=moderation_data.get("isViolation", False),
            violationScore=moderation_data.get("violationScore", 0.0),
            maxSeverity=moderation_data.get("maxSeverity", SeverityEnum.NONE),
        )

        data = moderation.model_dump(mode="json", exclude_none=False, exclude={'id'})

        logger.info(f"Saving new moderation for target {target_id}")

        return await self.moderation_repo.save_moderation(data)


    async def save_updated(
        self,
        target_id: str,
        target_type: TargetTypeEnum,
        content: str,
        moderation_data: Dict
    ) -> dict:

        existing = await self.moderation_repo.get_by_target(
            target_id,
            target_type
        )

        if not existing:
            raise ValueError(
                f"Moderation not found for target {target_id}"
            )

        update_data = {
            "isViolation": moderation_data.get(
                "isViolation",
                existing.get("isViolation"),
            ),
            "violationScore": moderation_data.get(
                "violationScore",
                existing.get("violationScore"),
            ),
            "maxSeverity": moderation_data.get(
                "maxSeverity",
                existing.get("maxSeverity"),
            ),
        }

        # ---- text ----
        if moderation_data.get("textResult"):
            t = moderation_data["textResult"]

            text_result_dto = TextModerationResult(
                content=content,
                isViolation=t.get("isViolation", False),
                violationScore=t.get("violationScore", 0.0),
                source=t.get("source", "keyword"),
                sensitive=t.get("sensitive", False),
                flags=t.get("flags") or {},
            )

            update_data["textResult"] = text_result_dto.model_dump(mode="json")

        # ---- image ----
        if moderation_data.get("imageResults") is not None:

            image_results: List[ImageModerationResult] = []

            for img in moderation_data.get("imageResults", []):
                image_results.append(
                    ImageModerationResult(
                        url=img.get("url", ""),
                        isViolation=img.get("isViolation", False),
                        violation=img.get("violation"),
                        severity=img.get("severity", SeverityEnum.NONE),
                        violationScore=img.get("violationScore"),
                        signalStrength=img.get("signalStrength"),
                        category=img.get("category"),
                        scores=img.get("scores"),
                        error=img.get("error"),
                    )
                )

            update_data["imageResults"] = [
                img.model_dump(mode="json") for img in image_results
            ]

        return await self.moderation_repo.update_moderation(
            existing["_id"],
            update_data,
        )
