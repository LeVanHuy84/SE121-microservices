"""
Image Moderation Orchestrator
- Downloads images
- Uses CLIP-based UnsafeSceneDetector
- Applies moderation policy & severity mapping
"""

import logging
import aiohttp
from typing import List, Optional

from app.services.ai.image_moderation.unsafe_scene_detector import (
    unsafe_scene_detector,
)

logger = logging.getLogger(__name__)

# ==================================================
# HTTP SESSION (reuse – production safe)
# ==================================================

_http_session: Optional[aiohttp.ClientSession] = None


async def _get_http_session() -> aiohttp.ClientSession:
    global _http_session
    if _http_session is None or _http_session.closed:
        _http_session = aiohttp.ClientSession()
    return _http_session


# ==================================================
# IMAGE DOWNLOAD
# ==================================================

async def download_image(url: str) -> Optional[bytes]:
    try:
        session = await _get_http_session()
        async with session.get(url, timeout=10) as res:
            if res.status == 200:
                return await res.read()
            logger.warning("[ImageDownload] status=%s url=%s", res.status, url)
    except Exception as e:
        logger.error("[ImageDownload] failed url=%s error=%s", url, e)
    return None


# ==================================================
# MODERATION CORE
# ==================================================

async def moderate_single_image_url(url: str) -> dict:
    image_data = await download_image(url)

    if not image_data:
        return {
            "url": url,
            "is_violation": False,
            "severity": "none",
            "violations": [],
            "safe": True,
            "unsafe_details": None,
            "error": "download_failed",
            "retryable": True,
        }

    # CLIP-based unsafe semantic detection
    unsafe = unsafe_scene_detector.detect(image_data)

    severity = _determine_severity(unsafe)

    violations: List[str] = []
    if unsafe.get("is_unsafe"):
        violations.append(
            f"unsafe:{unsafe['category']}:{unsafe.get('signal_strength', 'none')}"
        )

    return {
        "url": url,
        "is_violation": severity != "none",
        "severity": severity,
        "violations": violations,
        "safe": severity == "none",
        "unsafe_details": unsafe,
        "error": None,
        "retryable": False,
    }


async def moderate_multiple_image_urls(urls: List[str]) -> List[dict]:
    import asyncio
    return await asyncio.gather(
        *[moderate_single_image_url(url) for url in urls]
    )


# ==================================================
# SEVERITY POLICY (CENTRALIZED)
# ==================================================

def _determine_severity(unsafe: dict) -> str:
    """
    Severity levels:
    - high
    - medium
    - weak
    - none
    """

    if not unsafe or not unsafe.get("is_unsafe"):
        return "none"

    category = unsafe.get("category", "safe")
    strength = unsafe.get("signal_strength", "none")

    # Category override (policy)
    CATEGORY_SEVERITY_OVERRIDE = {
        "sexual_explicit": "high",
        "sexual_suggestive": "medium",
    }

    if category in CATEGORY_SEVERITY_OVERRIDE:
        return CATEGORY_SEVERITY_OVERRIDE[category]

    # Strength-based fallback
    STRENGTH_TO_SEVERITY = {
        "strong": "high",
        "medium": "medium",
        "weak": "weak",
    }

    return STRENGTH_TO_SEVERITY.get(strength, "none")
