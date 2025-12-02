# app/services/model_loader.py

import logging
import numpy as np
import cv2
from fer import FER
from transformers import AutoTokenizer, AutoModelForSequenceClassification, pipeline

logger = logging.getLogger(__name__)


class ModelLoader:
    """
    Load toàn bộ model cần thiết cho hệ thống:
    - PhoBERT Emotion (text)
    - FER (image emotion) → PyTorch backend
    """

    fer_warmed = False

    def __init__(self):
        self._load_phobert()
        self._load_fer_detector()

    # -----------------------------
    #  PHOBERT TEXT EMOTION
    # -----------------------------
    def _load_phobert(self):
        model_name = "visolex/phobert-emotion"
        logger.info("[ModelLoader] Loading PhoBERT emotion model...")

        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModelForSequenceClassification.from_pretrained(model_name)

        self.emotion_pipeline = pipeline(
            "text-classification",
            model=self.model,
            tokenizer=self.tokenizer,
        )

        logger.info("[ModelLoader] PhoBERT emotion model loaded.")

    # -----------------------------
    #  FER LOADER
    # -----------------------------
    def _load_fer_detector(self):
        """
        Load FER model (PyTorch) cho image emotion.
        """
        logger.info("[ModelLoader] Loading FER model (PyTorch)...")
        self.fer_detector = FER(mtcnn=True)
        logger.info("[ModelLoader] FER model loaded.")

    # -----------------------------
    #  FER WARMUP
    # -----------------------------
    @classmethod
    def warmup_fer(cls):
        if cls.fer_warmed:
            return

        logger.info("[ModelLoader] Warming up FER model...")

        try:
            # dummy image
            dummy = np.zeros((150, 150, 3), dtype=np.uint8)
            detector = FER()
            detector.detect_emotions(dummy)

            cls.fer_warmed = True
            logger.info("[ModelLoader] FER warmup completed.")

        except Exception as e:
            logger.exception("[ModelLoader] FER warmup failed: %s", e)

    # -----------------------------
    #  IMAGE EMOTION API (FER)
    # -----------------------------
    def analyze_image_emotion(self, image):
        """
        Phân tích cảm xúc từ ảnh bằng FER (PyTorch).
        Input:
            - image: numpy array (BGR) hoặc raw bytes sau khi decode cv2
        Output:
            {
                "dominant_emotion": "happy",
                "emotions": {...},
                "box": [...]
            }
        """

        # Nếu image là bytes -> decode
        if isinstance(image, bytes):
            nparr = np.frombuffer(image, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        result = self.fer_detector.detect_emotions(image)

        if not result:
            return {
                "dominant_emotion": "neutral",
                "emotions": {
                    "angry": 0,
                    "disgust": 0,
                    "fear": 0,
                    "happy": 0,
                    "sad": 0,
                    "surprise": 0,
                    "neutral": 1,
                },
                "box": None,
            }

        data = result[0]
        emotions = data["emotions"]

        dominant = max(emotions, key=emotions.get)

        return {
            "dominant_emotion": dominant,
            "emotions": emotions,
            "box": data["box"]
        }


# Singleton
model_loader = ModelLoader()
