import logging
from typing import List, Dict

from app.database.moderation_repository import ModerationRepository
from app.database.schemas.moderation_result import (
    ModerationResult,
    TextModerationResult,
    ImageModerationResult,
    ImageUnsafeDetails
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
    ) -> ModerationResult:
        
        # ---- text result ----
        text_result = None
        if moderation_data.get("text_result"):
            t = moderation_data["text_result"]
            text_result = TextModerationResult(
                content=content,
                is_violation=t.get("is_violation", False),
                violation_score=t.get("violation_score", 0.0),
                source=t.get("source", "keyword"),
                sensitive=t.get("sensitive", False),
                flags=t.get("flags") or {},
            )

        # ---- image results ----
        image_results: List[ImageModerationResult] = []

        for img in moderation_data.get("image_results", []):
            # Convert severity to string value for ODMantic serialization
            severity = img.get("severity", "none")
            if isinstance(severity, SeverityEnum):
                severity = severity.value
            elif not isinstance(severity, str):
                severity = SeverityEnum(severity).value

            # Build image result dict with all fields as primitives/dicts
            image_data = {
                "url": img.get("url", ""),
                "is_violation": img.get("is_violation", False),
                "violation": img.get("violation"),
                "severity": severity,
                "violation_score": img.get("violation_score"),
                "signal_strength": img.get("signal_strength"),
                "unsafe_details": img.get("unsafe_details"),  # Pass dict directly, not EmbeddedModel object
                "error": img.get("error"),
            }

            # Create ImageModerationResult from dict
            image_results.append(ImageModerationResult(**image_data))

        # Convert max_severity to string value for ODMantic serialization
        max_severity = moderation_data.get("max_severity", "none")
        if isinstance(max_severity, SeverityEnum):
            max_severity = max_severity.value
        elif not isinstance(max_severity, str):
            max_severity = SeverityEnum(max_severity).value

        # Convert targetType enum to string value
        target_type_str = target_type.value if isinstance(target_type, TargetTypeEnum) else str(target_type)

        moderation = ModerationResult(
            userId=user_id,
            targetId=target_id,
            targetType=target_type_str,
            text_result=text_result,
            image_results=image_results,
            is_violation=moderation_data.get("is_violation", False),
            violation_score=moderation_data.get("violation_score", 0.0),
            max_severity=max_severity,
        )

        return await self.moderation_repo.save_moderation_raw(moderation)

    async def save_updated(
        self,
        existing: ModerationResult,
        new_content: str,
        moderation_data: Dict
    ) -> ModerationResult:

        # Convert max_severity to string value
        max_severity = moderation_data.get("max_severity", existing.max_severity)
        if isinstance(max_severity, SeverityEnum):
            max_severity = max_severity.value
        elif not isinstance(max_severity, str):
            max_severity = SeverityEnum(max_severity).value

        update_data = {
            "is_violation": moderation_data.get("is_violation", existing.is_violation),
            "violation_score": moderation_data.get(
                "violation_score",
                existing.violation_score
            ),
            "max_severity": max_severity,
        }

        # ---- update text result ----
        if moderation_data.get("text_result"):
            t = moderation_data["text_result"]
            update_data["text_result"] = TextModerationResult(
                content=new_content,
                is_violation=t.get("is_violation", False),
                violation_score=t.get("violation_score", 0.0),
                source=t.get("source", "keyword"),
                sensitive=t.get("sensitive", False),
                flags=t.get("flags") or {},
            )

        # ---- update image results (replace all) ----
        if moderation_data.get("image_results") is not None:
            image_results: List[ImageModerationResult] = []

            for img in moderation_data.get("image_results", []):
                # Convert severity to string value
                severity = img.get("severity", "none")
                if isinstance(severity, SeverityEnum):
                    severity = severity.value
                elif not isinstance(severity, str):
                    severity = SeverityEnum(severity).value

                # Build image result dict with all fields as primitives/dicts
                image_data = {
                    "url": img.get("url", ""),
                    "is_violation": img.get("is_violation", False),
                    "violation": img.get("violation"),
                    "severity": severity,
                    "violation_score": img.get("violation_score"),
                    "signal_strength": img.get("signal_strength"),
                    "unsafe_details": img.get("unsafe_details"),  # Pass dict directly
                    "error": img.get("error"),
                }

                image_results.append(ImageModerationResult(**image_data))

            update_data["image_results"] = image_results

        return await self.moderation_repo.update_moderation(
            str(existing.id),
            update_data
        )
