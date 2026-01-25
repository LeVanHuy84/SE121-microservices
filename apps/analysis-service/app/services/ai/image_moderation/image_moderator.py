# app/services/ai/image_moderation/image_moderator.py

import logging
import aiohttp
from typing import List

from app.services.ai.image_moderation.nsfw_detector import nsfw_detector
from app.services.ai.image_moderation.violence_detector import violence_detector

logger = logging.getLogger(__name__)


async def download_image(url: str) -> bytes | None:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=10) as res:
                if res.status == 200:
                    return await res.read()
    except Exception as e:
        logger.error(f"Download failed: {e}")
    return None


async def moderate_single_image_url(url: str) -> dict:
    image_data = await download_image(url)

    if not image_data:
        return {
            "url": url,
            "error": "download_failed",
            "retryable": True,
        }

    nsfw = nsfw_detector.detect(image_data)
    violence = violence_detector.detect(image_data)

    # 🔥 RULE 1: NSFW overrides blood
    if nsfw["is_nsfw"]:
        violence["is_violent"] = False
        violence["category"] = "safe"

    severity = _determine_severity(nsfw, violence)

    violations = []
    if nsfw["is_nsfw"]:
        violations.append(f"nsfw_{nsfw['category']}")
    if violence["is_violent"]:
        violations.append(f"violence_{violence['category']}")

    return {
        "url": url,
        "is_violation": severity in ["medium", "high"],
        "severity": severity,
        "violations": violations,
        "safe": severity == "none",
    }


async def moderate_multiple_image_urls(urls: List[str]) -> List[dict]:
    import asyncio
    return await asyncio.gather(*[moderate_single_image_url(u) for u in urls])


def _determine_severity(nsfw: dict, violence: dict) -> str:
    if nsfw["category"] == "explicit":
        return "high"

    if nsfw["category"] == "suggestive":
        return "medium"

    if (
        violence["category"] == "blood"
        and violence["confidence"] > 0.6
    ):
        return "medium"

    return "none"
