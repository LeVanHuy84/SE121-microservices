# app/services/ai/image_understanding/clip_analyzer.py

import logging
import torch
import numpy as np
from PIL import Image
from io import BytesIO
from typing import Dict
from app.enums.emotion_enum import EmotionEnum

from .clip_loader import clip_loader, ensure_clip_loaded
from .clip_prompts import (
    CLIP_MODERATION_PROMPTS,
    EMOTION_PROMPTS,
    flatten_prompts,
)

logger = logging.getLogger(__name__)


class CLIPAnalyzer:
    """
    CLIP-based Image Analyzer

    - Moderation: ONE-PASS multiclass softmax
    - Emotion: ONE-PASS multiclass softmax
    """

    # =========================================================================
    # PUBLIC APIs
    # =========================================================================

    def get_clip_model_name(self) -> str:
        return clip_loader.get_model_name()

    def analyze_moderation(self, image_data: bytes) -> Dict[str, float]:
        ensure_clip_loaded()
        image = Image.open(BytesIO(image_data)).convert("RGB")

        labels, texts = flatten_prompts(CLIP_MODERATION_PROMPTS)
        probs = self._compute_clip_probs(image, texts)

        return self._aggregate_max(labels, probs)

    def analyze_emotion(self, image_data: bytes) -> Dict[str, float]:
        ensure_clip_loaded()
        image = Image.open(BytesIO(image_data)).convert("RGB")

        labels, texts = flatten_prompts(EMOTION_PROMPTS)
        probs = self._compute_clip_probs(image, texts)

        raw = self._aggregate_max(labels, probs)

        # DOMAIN ENFORCEMENT
        return {
            k: v for k, v in raw.items()
            if k in EmotionEnum._value2member_map_
        }

    # =========================================================================
    # CORE CLIP
    # =========================================================================

    def _compute_clip_probs(
        self,
        image: Image.Image,
        texts: list[str],
    ) -> np.ndarray:
        model = clip_loader.get_model()
        processor = clip_loader.get_processor()
        device = clip_loader.get_device()

        inputs = processor(
            text=texts,
            images=image,
            return_tensors="pt",
            padding=True,
        ).to(device)

        with torch.no_grad():
            logits = model(**inputs).logits_per_image[0]
            probs = torch.softmax(logits, dim=0)

        return probs.cpu().numpy()

    # =========================================================================
    # AGGREGATION
    # =========================================================================

    def _aggregate_max(
        self,
        labels: list[str],
        scores: np.ndarray,
    ) -> Dict[str, float]:
        result: Dict[str, float] = {}
        for label, score in zip(labels, scores):
            result[label] = max(result.get(label, 0.0), float(score))
        return result


# Singleton
clip_analyzer = CLIPAnalyzer()
