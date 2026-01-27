# app/services/ai/image_emotion/fer_analyzer.py

import logging
import numpy as np
from PIL import Image
from io import BytesIO

from fer import FER

logger = logging.getLogger(__name__)


class FERAnalyzer:
    """
    Facial Emotion Recognition using FER2013 pretrained model.

    AI Layer:
    - Pure inference
    - No heuristics
    - No business rules
    """

    _instance_initialized = False

    def __init__(self):
        self.detector: FER | None = None

        self.emotion_labels = [
            "angry",
            "disgust",
            "fear",
            "happy",
            "sad",
            "surprise",
            "neutral",
        ]

    def initialize(self):
        if self._instance_initialized:
            return

        try:
            # mtcnn=True gives better face detection
            self.detector = FER(mtcnn=True)

            self._instance_initialized = True
            logger.info("[FERAnalyzer] FER2013 model loaded")

        except Exception as e:
            logger.exception("[FERAnalyzer] Initialization failed")
            raise

    def analyze_image(self, image_data: bytes) -> dict:
        if not self._instance_initialized:
            self.initialize()

        try:
            image = Image.open(BytesIO(image_data)).convert("RGB")
            image_np = np.array(image)

            results = self.detector.detect_emotions(image_np)

            if not results:
                return self._neutral_fallback()

            face_emotions = [r["emotions"] for r in results]

            aggregated = self._aggregate_emotions(face_emotions)
            dominant = max(aggregated, key=aggregated.get)

            return {
                "dominant_emotion": dominant,   # angry / happy / sad
                "emotions": aggregated,         # raw FER scores
                "confidence": round(aggregated[dominant], 4),
                "face_count": len(results),
                "model": "fer2013",
            }


        except Exception as e:
            logger.exception(f"[FERAnalyzer] Error analyzing image: {e}")
            raise

    def _aggregate_emotions(self, face_emotions: list[dict]) -> dict:
        aggregated = {k: 0.0 for k in self.emotion_labels}

        for emotions in face_emotions:
            for k in aggregated:
                aggregated[k] += emotions.get(k, 0.0)

        count = len(face_emotions)
        return {k: round(v / count, 4) for k, v in aggregated.items()}


    def _neutral_fallback(self) -> dict:
        return {
            "dominant_emotion": "neutral",
            "emotions": {
                "anger": 0.0,
                "disgust": 0.0,
                "fear": 0.0,
                "joy": 0.0,
                "sadness": 0.0,
                "surprise": 0.0,
                "neutral": 1.0,
            },
            "confidence": 0.3,
            "face_count": 0,
            "model": "fer2013",
        }


# Singleton
fer_analyzer = FERAnalyzer()


def ensure_fer_loaded():
    if not fer_analyzer._instance_initialized:
        fer_analyzer.initialize()
