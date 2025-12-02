# app/services/emotion_detector.py

from typing import Dict, Any, List
import numpy as np
import logging
import requests
import cv2
from app.utils.image_downloader import download_image_to_cv2
from app.utils.emotion_normalizer import normalize_image_label
from app.enums.emotion_enum import EmotionEnum
from app.services.model_loader import model_loader

logger = logging.getLogger(__name__)


from app.utils.emotion_normalizer import normalize_image_label
from app.enums.emotion_enum import EmotionEnum

def analyze_image_cv2(img_bgr: np.ndarray) -> Dict[str, Any]:
    if img_bgr is None:
        raise ValueError("Image is None")

    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    result = model_loader.analyze_image_emotion(img_rgb)

    face_count = result.get("face_count", 0)
    emotions = result.get("emotions", {})
    dominant_raw = result.get("dominant_emotion")

    # Normalize dominant
    dominant = normalize_image_label(dominant_raw)

    # Normalize scores
    clean_scores = {}
    for k, v in emotions.items():
        try:
            enum_key = normalize_image_label(k)
            clean_scores[enum_key] = float(v)
        except Exception:
            pass

    return {
        "face_count": face_count,
        "dominant_emotion": dominant.value,
        "emotion_scores": {k.value: v for k, v in clean_scores.items()}
    }


def analyze_multiple_image_urls(urls: List[str], timeout: int = 10) -> List[Dict[str, Any]]:
    results = []

    for url in urls:
        try:
            img = download_image_to_cv2(url, timeout=timeout)
            if img is None:
                results.append({"url": url, "error": "download_failed_or_invalid_image"})
                continue

            analysis = analyze_image_cv2(img)
            results.append({
                "url": url,
                "face_count": analysis["face_count"],
                "dominant_emotion": analysis["dominant_emotion"],
                "emotion_scores": analysis["emotion_scores"]
            })
        except Exception as e:
            logger.exception("Error analyzing image %s: %s", url, e)
            results.append({"url": url, "error": str(e)})

    return results

