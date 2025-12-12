# app/services/emotion_detector.py

from typing import Dict, Any, List
import numpy as np
import logging
import cv2
import asyncio
import aiohttp
from app.utils.image_downloader import download_image_to_cv2
from app.utils.emotion_normalizer import normalize_image_label
from app.services.model_loader import model_loader

logger = logging.getLogger(__name__)


from app.utils.exceptions import RetryableException

def analyze_image_cv2(img_bgr: np.ndarray) -> Dict[str, Any]:
    if img_bgr is None:
        raise ValueError("Image is None")

    try:
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    except Exception as e:
        raise Exception(f"Invalid image data: {str(e)}")

    try:
        result = model_loader.analyze_image_emotion(img_rgb)
    except Exception as e:
        raise RetryableException(
            f"Model inference error: {str(e)}"
        )

    # SAFE PARSING
    face_count = result.get("face_count", 0)
    emotions = result.get("emotions", {})
    dominant_raw = result.get("dominant_emotion")

    dominant = normalize_image_label(dominant_raw) if dominant_raw else None

    clean_scores = {}
    for k, v in emotions.items():
        try:
            enum_key = normalize_image_label(k)
            clean_scores[enum_key] = float(v)
        except Exception:
            pass

    return {
        "face_count": face_count,
        "dominant_emotion": dominant.value if dominant else None,
        "emotion_scores": {k.value: v for k, v in clean_scores.items()}
    }


# ----------------------------
#       ASYNC FUNCTION
# ----------------------------
async def analyze_multiple_image_urls(
    urls: List[str],
    timeout: int = 10
) -> List[Dict[str, Any]]:

    timeout = aiohttp.ClientTimeout(total=15)

    async with aiohttp.ClientSession(timeout=timeout) as session:
        download_tasks = [
            download_image_to_cv2(url, session) for url in urls
        ]
        download_results = await asyncio.gather(*download_tasks)

    results = []

    for url, res in zip(urls, download_results):
        try:
            # ❌ Download failed
            if not res.ok:
                results.append({
                    "url": url,
                    "error": res.error.message,
                    "retryable": res.error.retryable
                })
                continue

            # ✅ Analyze image
            analysis = analyze_image_cv2(res.image)

            results.append({
                "url": url,
                "face_count": analysis["face_count"],
                "dominant_emotion": analysis["dominant_emotion"],
                "emotion_scores": analysis["emotion_scores"]
            })

        except Exception as e:
            logger.exception("Error analyzing image %s: %s", url, e)
            results.append({
                "url": url,
                "error": str(e),
                "retryable": False
            })

    return results

