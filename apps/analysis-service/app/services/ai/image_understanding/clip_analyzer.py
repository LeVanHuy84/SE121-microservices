# app/services/ai/image_understanding/clip_analyzer.py

import logging
import torch
import numpy as np
from PIL import Image
from io import BytesIO
from typing import Dict

from .clip_loader import clip_loader, ensure_clip_loaded
from .clip_prompts import (
    get_negative_semantic_prompts,
    get_sexual_content_prompts,
    get_emotion_prompts,
    flatten_prompts,
)

logger = logging.getLogger(__name__)


class CLIPAnalyzer:
    """
    CLIP-based Image Analyzer

    Responsibilities:
    - Scene safety (violence / weapon / blood / disturbing)
    - Sexual content (explicit / suggestive)
    - Scene-level emotion

    NOTE:
    - Moderation uses BINARY dominance comparison (no global softmax)
    - Emotion uses MULTI-CLASS softmax
    """

    # =========================================================================
    # PUBLIC APIs
    # =========================================================================

    def analyze_unsafe_scene(self, image_data: bytes) -> Dict[str, float]:
        """
        Analyze unsafe scene content (NON sexual).
        """
        ensure_clip_loaded()
        image = Image.open(BytesIO(image_data)).convert("RGB")

        prompts = get_negative_semantic_prompts()
        return self._analyze_binary_categories(image, prompts)

    def analyze_sexual_content(self, image_data: bytes) -> Dict[str, float]:
        """
        Analyze sexual content (explicit / suggestive).
        """
        ensure_clip_loaded()
        image = Image.open(BytesIO(image_data)).convert("RGB")

        prompts = get_sexual_content_prompts()
        return self._analyze_binary_categories(image, prompts)

    def analyze_emotion(self, image_data: bytes) -> Dict[str, float]:
        """
        Analyze scene-level emotion (multi-class).
        """
        ensure_clip_loaded()
        image = Image.open(BytesIO(image_data)).convert("RGB")

        emotion_prompts = get_emotion_prompts()
        labels, texts = flatten_prompts(emotion_prompts)

        scores = self._compute_multiclass_clip_scores(image, texts)
        return self._aggregate_max(labels, scores)

    # =========================================================================
    # MODERATION CORE (BINARY DOMINANCE)
    # =========================================================================

    def _analyze_binary_categories(
        self,
        image: Image.Image,
        prompt_dict: Dict[str, list],
    ) -> Dict[str, float]:
        """
        Analyze categories by comparing each category AGAINST safe.
        """
        safe_prompts = prompt_dict.get("safe", [])
        results = {}

        for category, prompts in prompt_dict.items():
            if category == "safe":
                continue

            texts = prompts + safe_prompts
            scores = self._compute_binary_clip_scores(image, texts)

            # split
            unsafe_scores = scores[: len(prompts)]
            safe_scores = scores[len(prompts):]

            # dominance score
            results[category] = float(max(unsafe_scores))
            results["safe"] = max(results.get("safe", 0.0), float(max(safe_scores)))

        return results

    # =========================================================================
    # CLIP SCORE COMPUTATION
    # =========================================================================

    def _compute_binary_clip_scores(
        self,
        image: Image.Image,
        texts: list,
    ) -> np.ndarray:
        """
        Compute CLIP scores for SMALL prompt set (unsafe vs safe).
        Uses softmax ONLY within this small group.
        """
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
            outputs = model(**inputs)
            logits = outputs.logits_per_image[0]
            probs = torch.softmax(logits, dim=0)

        return probs.cpu().numpy()

    def _compute_multiclass_clip_scores(
        self,
        image: Image.Image,
        texts: list,
    ) -> np.ndarray:
        """
        Compute CLIP scores for multi-class problems (emotion).
        """
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
            outputs = model(**inputs)
            logits = outputs.logits_per_image
            probs = logits.softmax(dim=1).cpu().numpy()[0]

        return probs

    # =========================================================================
    # AGGREGATION
    # =========================================================================

    def _aggregate_max(
        self,
        labels: list,
        scores: np.ndarray,
    ) -> Dict[str, float]:
        """
        Use MAX score per category (best for moderation & emotion).
        """
        result = {}
        for label, score in zip(labels, scores):
            result[label] = max(result.get(label, 0.0), float(score))
        return result


# Singleton
clip_analyzer = CLIPAnalyzer()
