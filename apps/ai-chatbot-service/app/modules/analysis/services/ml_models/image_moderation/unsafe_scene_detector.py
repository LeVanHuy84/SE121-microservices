# app/services/ai/image_moderation/unsafe_scene_detector.py

"""
Unsafe Scene Detector
- Single-pass CLIP moderation
- ONLY AI inference result
- NO business / policy decision
"""

import logging
from typing import Dict

from ..image_understanding import clip_analyzer, ensure_clip_loaded

logger = logging.getLogger(__name__)


class UnsafeSceneDetector:
    _initialized = False

    # =========================
    # Thresholds (AI-level)
    # =========================
    SEXUAL_TH = 0.45
    SCENE_UNSAFE_TH = 0.45

    PRIORITY = [
        "sexual",
        "violence",
        "weapon",
        "blood",
        "disturbing",
    ]

    def initialize(self):
        if self._initialized:
            return
        ensure_clip_loaded()
        logger.info("[UnsafeSceneDetector] CLIP moderation initialized")
        self._initialized = True

    def detect(self, image_data: bytes) -> Dict:
        if not self._initialized:
            self.initialize()

        try:
            scores = clip_analyzer.analyze_moderation(image_data)
            scores = {k: round(float(v), 4) for k, v in scores.items()}

            violation_score = self._max_non_safe_score(scores)

            # find first violating category by priority
            for cat in self.PRIORITY:
                if scores.get(cat, 0.0) >= self._threshold(cat):
                    return self._unsafe(cat, violation_score, scores)

            return self._safe(violation_score, scores)

        except Exception as e:
            logger.exception("[UnsafeSceneDetector] Error")
            return {
                "is_unsafe": False,
                "category": "safe",
                "violation_score": 0.0,
                "scores": None,
                "error": str(e),
            }

    # ==================================================
    # INTERNAL
    # ==================================================

    def _threshold(self, cat: str) -> float:
        return self.SEXUAL_TH if cat == "sexual" else self.SCENE_UNSAFE_TH

    def _max_non_safe_score(self, scores: Dict) -> float:
        if not scores:
            return 0.0

        non_safe = [
            v for k, v in scores.items()
            if k != "safe"
        ]

        return max(non_safe) if non_safe else 0.0

    def _unsafe(self, category: str, violation_score: float, scores: Dict) -> Dict:
        return {
            "is_unsafe": True,
            "category": category,
            "violation_score": round(violation_score, 4),
            "scores": scores,
            "error": None,
        }

    def _safe(self, violation_score: float, scores: Dict) -> Dict:
        return {
            "is_unsafe": False,
            "category": "safe",
            "violation_score": round(violation_score, 4),
            "scores": scores,
            "error": None,
        }


# Singleton
unsafe_scene_detector = UnsafeSceneDetector()


def ensure_unsafe_scene_detector_loaded():
    if not unsafe_scene_detector._initialized:
        unsafe_scene_detector.initialize()
