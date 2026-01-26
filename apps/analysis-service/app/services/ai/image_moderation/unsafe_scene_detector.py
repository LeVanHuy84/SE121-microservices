# app/services/ai/image_moderation/unsafe_scene_detector.py

"""
Unsafe Scene Detector
- Single-pass CLIP moderation
- Threshold + priority based
"""

import logging
from typing import Dict

from app.services.ai.image_understanding import clip_analyzer, ensure_clip_loaded

logger = logging.getLogger(__name__)


class UnsafeSceneDetector:
    _initialized = False

    # =========================
    # Thresholds (tunable)
    # =========================
    SEXUAL_EXPLICIT_TH = 0.45
    SEXUAL_SUGGESTIVE_TH = 0.40
    SCENE_UNSAFE_TH = 0.45

    PRIORITY = [
        "sexual_explicit",
        "sexual_suggestive",
        "violence",
        "weapon",
        "blood",
        "disturbing",
    ]

    def initialize(self):
        if self._initialized:
            return
        ensure_clip_loaded()
        logger.info("[UnsafeSceneDetector] CLIP single-pass moderation enabled")
        self._initialized = True

    def detect(self, image_data: bytes) -> Dict:
        if not self._initialized:
            self.initialize()

        try:
            scores = clip_analyzer.analyze_moderation(image_data)

            for cat in self.PRIORITY:
                if scores.get(cat, 0.0) >= self._threshold(cat):
                    return self._unsafe(cat, scores[cat], scores)

            return self._safe(scores)

        except Exception as e:
            logger.exception("[UnsafeSceneDetector] Error")
            return {
                "is_unsafe": False,
                "category": "safe",
                "confidence": 0.0,
                "signal_strength": "none",
                "model": "clip",
                "error": str(e),
            }

    # =========================================================================
    # HELPERS
    # =========================================================================

    def _threshold(self, cat: str) -> float:
        if cat == "sexual_explicit":
            return self.SEXUAL_EXPLICIT_TH
        if cat == "sexual_suggestive":
            return self.SEXUAL_SUGGESTIVE_TH
        return self.SCENE_UNSAFE_TH

    def _unsafe(self, category: str, confidence: float, scores: Dict) -> Dict:
        return {
            "is_unsafe": True,
            "category": category,
            "confidence": round(confidence, 4),
            "signal_strength": self._signal_strength(confidence),
            "model": "clip",
            "scores": {k: round(v, 4) for k, v in scores.items()},
        }

    def _safe(self, scores: Dict) -> Dict:
        safe_score = scores.get("safe", 0.0)
        return {
            "is_unsafe": False,
            "category": "safe",
            "confidence": round(safe_score, 4),
            "signal_strength": self._signal_strength(safe_score),
            "model": "clip",
            "scores": {k: round(v, 4) for k, v in scores.items()},
        }

    def _signal_strength(self, confidence: float) -> str:
        if confidence >= 0.75:
            return "strong"
        if confidence >= 0.50:
            return "medium"
        if confidence >= 0.30:
            return "weak"
        return "none"


# Singleton
unsafe_scene_detector = UnsafeSceneDetector()


def ensure_unsafe_scene_detector_loaded():
    if not unsafe_scene_detector._initialized:
        unsafe_scene_detector.initialize()
