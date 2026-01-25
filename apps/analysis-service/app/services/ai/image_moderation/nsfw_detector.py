# app/services/ai/image_moderation/nsfw_detector.py

import logging
import os
import tempfile
import numpy as np
import cv2
from PIL import Image
from io import BytesIO
from typing import Dict

logger = logging.getLogger(__name__)


class NSFWDetector:
    _instance_initialized = False

    EXPLICIT_CLASSES = {
        "EXPOSED_GENITALIA_F",
        "EXPOSED_GENITALIA_M",
        "EXPOSED_BREAST_F",
        "EXPOSED_BUTTOCKS",
    }

    SUGGESTIVE_CLASSES = {
        "COVERED_GENITALIA_F",
        "COVERED_GENITALIA_M",
        "COVERED_BREAST_F",
        "COVERED_BUTTOCKS",
    }

    def __init__(self):
        self.model = None

    def initialize(self):
        if self._instance_initialized:
            return
        try:
            from nudenet import NudeDetector
            self.model = NudeDetector()
            self._instance_initialized = True
            logger.info("[NSFWDetector] NudeNet loaded")
        except Exception:
            logger.exception("[NSFWDetector] NudeNet load failed")
            self.model = None

    def detect(self, image_data: bytes) -> Dict:
        if not self._instance_initialized:
            self.initialize()

        try:
            image = self._bytes_to_image(image_data)
            if self.model:
                return self._model_detect(image)
            return self._heuristic_detect(image)
        except Exception as e:
            logger.exception("[NSFWDetector] Detection error")
            return {
                "is_nsfw": False,
                "category": "unknown",
                "confidence": 0.0,
                "signal_strength": "none",
                "model": "nsfw_detector",
                "error": str(e),
            }

    def _bytes_to_image(self, image_data: bytes) -> np.ndarray:
        image = Image.open(BytesIO(image_data)).convert("RGB")
        return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)

    def _model_detect(self, image: np.ndarray) -> Dict:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            path = tmp.name
            cv2.imwrite(path, image)

        try:
            detections = self.model.detect(path)
        finally:
            os.remove(path)

        explicit = sum(d["score"] for d in detections if d["class"] in self.EXPLICIT_CLASSES)
        suggestive = sum(d["score"] for d in detections if d["class"] in self.SUGGESTIVE_CLASSES)

        explicit = min(explicit, 1.0)
        suggestive = min(suggestive, 1.0)

        if explicit >= 0.3:
            return {
                "is_nsfw": True,
                "category": "explicit",
                "confidence": round(explicit, 4),
                "signal_strength": "strong",
                "model": "nudenet",
            }

        if suggestive >= 0.3:
            return {
                "is_nsfw": True,
                "category": "suggestive",
                "confidence": round(suggestive, 4),
                "signal_strength": "medium",
                "model": "nudenet",
            }

        return {
            "is_nsfw": False,
            "category": "safe",
            "confidence": round(1 - max(explicit, suggestive), 4),
            "signal_strength": "none",
            "model": "nudenet",
        }

    def _heuristic_detect(self, image: np.ndarray) -> Dict:
        return {
            "is_nsfw": False,
            "category": "safe",
            "confidence": 0.3,
            "signal_strength": "weak",
            "model": "heuristic",
        }


nsfw_detector = NSFWDetector()
