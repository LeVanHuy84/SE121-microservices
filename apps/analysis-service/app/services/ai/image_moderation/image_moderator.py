# app/services/ai/image_moderation/image_moderator.py
"""
Image Moderation Orchestrator
- Downloads images
- Calls UnsafeSceneDetector
- Applies severity & moderation policy
"""

import logging
import asyncio
from typing import List
from app.core.dto.image_input import ImageInput
from app.services.ai.image_moderation.unsafe_scene_detector import (
    unsafe_scene_detector,
)

logger = logging.getLogger(__name__)

# ==================================================
# MODERATION CORE
# ==================================================

async def moderate_single_image(image: ImageInput) -> dict:

    if not image.bytes:
        return {
            "url": image.url,
            "is_violation": False,
            "violation": None,
            "severity": "none",
            "violation_score": 0.0,
            "signal_strength": "none",
            "unsafe_details": None,
            "error": "download_failed",
        }

    ai_result = unsafe_scene_detector.detect(image.bytes)

    violation_score = float(ai_result.get("violation_score", 0.0))
    is_violation = bool(ai_result.get("is_unsafe"))

    severity = _determine_severity(is_violation, violation_score)

    return {
        "url": image.url,

        # 🔑 FINAL DECISION (image-level)
        "is_violation": is_violation,
        "violation": ai_result.get("category") if is_violation else None,
        "severity": severity,

        # 🔑 FLATTENED SIGNALS
        "violation_score": round(violation_score, 4),
        "signal_strength": _signal_strength(violation_score),

        # 🔍 AI DETAILS (for explain / debug)
        "unsafe_details": {
            "category": ai_result.get("category"),
            "scores": ai_result.get("scores"),
        } if ai_result else None,

        "error": ai_result.get("error"),
    }


async def moderate_multiple_images(images: List[ImageInput]) -> List[dict]:
    if not images:
        return []

    results = await asyncio.gather(
        *[moderate_single_image(image) for image in images],
        return_exceptions=True
    )

    return [r for r in results if isinstance(r, dict)]


# ==================================================
# SEVERITY POLICY (BUSINESS)
# ==================================================

def _determine_severity(is_violation: bool, violation_score: float) -> str:
    if not is_violation:
        return "none"

    if violation_score >= 0.75:
        return "high"
    if violation_score >= 0.50:
        return "medium"
    if violation_score >= 0.30:
        return "weak"
    return "none"


def _signal_strength(violation_score: float) -> str:
    if violation_score >= 0.75:
        return "strong"
    if violation_score >= 0.50:
        return "medium"
    if violation_score >= 0.30:
        return "weak"
    return "none"
