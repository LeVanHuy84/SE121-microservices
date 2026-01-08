# app/services/model_loader.py

import logging
import numpy as np
import cv2
import torch
from fer import FER
from transformers import AutoTokenizer, AutoModelForSequenceClassification

logger = logging.getLogger(__name__)


class ModelLoader:
    """
    Load toàn bộ model cần thiết cho hệ thống:
    - PhoBERT Emotion (text)
    - FER (image emotion) → PyTorch backend
    
    Models are loaded lazily on first use to:
    - Reduce startup time
    - Allow GPU device configuration
    - Avoid loading unused models
    """

    def __init__(self):
        self._tokenizer = None
        self._model = None
        self._fer_detector = None
        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"[ModelLoader] Using device: {self._device}")

    @property
    def tokenizer(self):
        """Lazy load PhoBERT tokenizer"""
        if self._tokenizer is None:
            self._load_phobert()
        return self._tokenizer

    @property
    def model(self):
        """Lazy load PhoBERT model"""
        if self._model is None:
            self._load_phobert()
        return self._model

    @property
    def fer_detector(self):
        """Lazy load FER detector"""
        if self._fer_detector is None:
            self._load_fer_detector()
        return self._fer_detector

    # -----------------------------
    #  PHOBERT TEXT EMOTION
    # -----------------------------
    def _load_phobert(self):
        """Load PhoBERT model to configured device"""
        if self._model is not None:
            return
            
        model_name = "visolex/phobert-emotion"
        logger.info(f"[ModelLoader] Loading PhoBERT emotion model to {self._device}...")

        self._tokenizer = AutoTokenizer.from_pretrained(model_name)
        self._model = AutoModelForSequenceClassification.from_pretrained(model_name)
        
        # Move model to GPU if available
        self._model.to(self._device)
        self._model.eval()  # Set to evaluation mode
        
        logger.info("[ModelLoader] PhoBERT emotion model loaded.")

    # -----------------------------
    #  FER LOADER
    # -----------------------------
    def _load_fer_detector(self):
        """
        Load FER model (PyTorch) cho image emotion.
        """
        if self._fer_detector is not None:
            return
            
        logger.info("[ModelLoader] Loading FER model (PyTorch)...")
        self._fer_detector = FER(mtcnn=True)
        logger.info("[ModelLoader] FER model loaded.")

    # -----------------------------
    #  WARMUP (Optional - for first request optimization)
    # -----------------------------
    def warmup(self):
        """Warmup all models with dummy inputs"""
        logger.info("[ModelLoader] Warming up models...")
        
        # Warmup PhoBERT
        try:
            dummy_text = "warmup text"
            inputs = self.tokenizer(dummy_text, return_tensors="pt").to(self._device)
            with torch.no_grad():
                _ = self.model(**inputs)
            logger.info("[ModelLoader] PhoBERT warmup completed")
        except Exception as e:
            logger.exception("[ModelLoader] PhoBERT warmup failed: %s", e)
        
        # Warmup FER
        try:
            dummy_img = np.zeros((150, 150, 3), dtype=np.uint8)
            _ = self.fer_detector.detect_emotions(dummy_img)
            logger.info("[ModelLoader] FER warmup completed")
        except Exception as e:
            logger.exception("[ModelLoader] FER warmup failed: %s", e)

    # -----------------------------
    #  IMAGE EMOTION API (FER)
    # -----------------------------
    def analyze_image_emotion(self, image):
        # decode if bytes
        if isinstance(image, bytes):
            nparr = np.frombuffer(image, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        result = self.fer_detector.detect_emotions(image)

        face_count = len(result)

        if face_count == 0:
            return {
                "face_count": 0,
                "dominant_emotion": "neutral",
                "emotions": {
                    "angry": 0, "disgust": 0, "fear": 0,
                    "happy": 0, "sad": 0, "surprise": 0,
                    "neutral": 1,
                },
                "box": None,
            }

        # Chỉ lấy mặt đầu tiên
        data = result[0]
        emotions = data["emotions"]
        dominant = max(emotions, key=emotions.get)

        return {
            "face_count": face_count,
            "dominant_emotion": dominant,
            "emotions": emotions,
            "box": data["box"]
        }


# Singleton instance
model_loader = ModelLoader()
