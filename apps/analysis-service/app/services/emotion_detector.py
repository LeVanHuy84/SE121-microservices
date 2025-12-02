# app/services/emotion_detector.py

from typing import Dict, Any, List
import numpy as np
import logging
import requests
import cv2

from app.services.model_loader import model_loader

logger = logging.getLogger(__name__)


def download_image_to_cv2(url: str, timeout: int = 10) -> np.ndarray:
    """
    Download an image from URL using requests and convert to OpenCV BGR numpy array.
    """
    try:
        resp = requests.get(url, timeout=timeout)
        resp.raise_for_status()
        arr = np.frombuffer(resp.content, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Invalid image data")
        return img
    except Exception as e:
        logger.warning("Failed to download image %s: %s", url, e)
        return None


def analyze_image_cv2(img_bgr: np.ndarray) -> Dict[str, Any]:
    """
    Analyze a single OpenCV BGR image using FER (via ModelLoader).
    Returns standardized dict with dominant_emotion + emotion_scores.
    """
    if img_bgr is None:
        raise ValueError("Image is None")

    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    result = model_loader.analyze_image_emotion(img_rgb)

    emotions = result.get("emotions", {})
    dominant = result.get("dominant_emotion", None)

    # Convert values to float
    clean_scores = {}
    for k, v in emotions.items():
        try:
            clean_scores[k] = float(v)
        except Exception:
            pass

    return {
        "dominant_emotion": dominant,
        "emotion_scores": clean_scores
    }


def analyze_multiple_image_urls(urls: List[str], timeout: int = 10) -> List[Dict[str, Any]]:
    """
    Analyze a list of image URLs sequentially (sync).
    Returns list of results dicts.
    """
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
                "dominant_emotion": analysis["dominant_emotion"],
                "emotion_scores": analysis["emotion_scores"]
            })
        except Exception as e:
            logger.exception("Error analyzing image %s: %s", url, e)
            results.append({"url": url, "error": str(e)})

    return results
