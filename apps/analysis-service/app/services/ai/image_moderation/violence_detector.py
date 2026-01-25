# app/services/ai/image_moderation/violence_detector.py

import logging
import numpy as np
import cv2
from PIL import Image
from io import BytesIO

logger = logging.getLogger(__name__)


class ViolenceDetector:
    _instance_initialized = False

    def initialize(self):
        if self._instance_initialized:
            return
        logger.info("[ViolenceDetector] Heuristic mode enabled")
        self._instance_initialized = True

    def detect(self, image_data: bytes) -> dict:
        if not self._instance_initialized:
            self.initialize()

        try:
            image = self._bytes_to_image(image_data)
            return self._heuristic_detect(image)
        except Exception as e:
            logger.exception("[ViolenceDetector] Error")
            return {
                "is_violent": False,
                "category": "safe",
                "confidence": 0.0,
                "signal_strength": "none",
                "model": "heuristic_violence",
                "error": str(e),
            }

    def _bytes_to_image(self, image_data: bytes) -> np.ndarray:
        image = Image.open(BytesIO(image_data)).convert("RGB")
        return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)

    def _heuristic_detect(self, image: np.ndarray) -> dict:
        blood_score = self._detect_blood(image)

        if blood_score > 0.5:
            return {
                "is_violent": True,
                "category": "blood",
                "confidence": round(blood_score, 4),
                "signal_strength": "weak",
                "model": "heuristic_violence",
            }

        return {
            "is_violent": False,
            "category": "safe",
            "confidence": round(1 - blood_score, 4),
            "signal_strength": "none",
            "model": "heuristic_violence",
        }

    def _detect_blood(self, image: np.ndarray) -> float:
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)

        lower1 = np.array([0, 70, 50])
        upper1 = np.array([10, 255, 255])
        lower2 = np.array([170, 70, 50])
        upper2 = np.array([180, 255, 255])

        mask = cv2.inRange(hsv, lower1, upper1) | cv2.inRange(hsv, lower2, upper2)
        ratio = np.count_nonzero(mask) / (image.shape[0] * image.shape[1])

        if ratio < 0.05:
            return 0.0

        return min(ratio * 4, 1.0)


violence_detector = ViolenceDetector()
