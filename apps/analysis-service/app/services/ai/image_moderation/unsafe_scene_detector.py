# app/services/ai/image_moderation/unsafe_scene_detector.py

"""
Unsafe Scene Detector - CLIP-based unsafe semantic detection
- Handles violence, weapons, blood, disturbing scenes, sexual content
- Uses dominance-based classification (unsafe vs safe)
- Thin wrapper over CLIPAnalyzer
"""

import logging
from typing import Dict

from app.services.ai.image_understanding import clip_analyzer, ensure_clip_loaded

logger = logging.getLogger(__name__)


class UnsafeSceneDetector:
    _instance_initialized = False

    # =========================
    # Dominance ratios (tunable)
    # =========================
    SEXUAL_EXPLICIT_RATIO = 2.5
    SEXUAL_SUGGESTIVE_RATIO = 2.0

    SCENE_UNSAFE_RATIO = 1.8

    def initialize(self):
        if self._instance_initialized:
            return
        ensure_clip_loaded()
        logger.info("[UnsafeSceneDetector] CLIP dominance-based unsafe detection enabled")
        self._instance_initialized = True

    def detect(self, image_data: bytes) -> Dict:
        if not self._instance_initialized:
            self.initialize()

        try:
            # =========================
            # 1️⃣ Run 2-pass CLIP
            # =========================
            sexual_scores = clip_analyzer.analyze_sexual_content(image_data)
            scene_scores = clip_analyzer.analyze_unsafe_scene(image_data)

            is_unsafe, category, confidence = self._classify(
                sexual_scores, scene_scores
            )

            return {
                "is_unsafe": is_unsafe,
                "category": category,
                "confidence": round(confidence, 4),
                "signal_strength": self._signal_strength(confidence),
                "model": "clip-v2",
                "scores": {
                    "sexual": {k: round(v, 4) for k, v in sexual_scores.items()},
                    "scene": {k: round(v, 4) for k, v in scene_scores.items()},
                },
            }

        except Exception as e:
            logger.exception("[UnsafeSceneDetector] Error")
            return {
                "is_unsafe": False,
                "category": "safe",
                "confidence": 0.0,
                "signal_strength": "none",
                "model": "clip-v2",
                "error": str(e),
            }

    # =====================================================================
    # CLASSIFICATION LOGIC (PURE DOMINANCE)
    # =====================================================================

    def _classify(
        self,
        sexual: Dict[str, float],
        scene: Dict[str, float],
    ) -> tuple:
        """
        Decide unsafe category using dominance rules.
        Priority: Sexual > Scene unsafe > Safe
        """

        sexual_safe = sexual.get("safe", 0.0)
        scene_safe = scene.get("safe", 0.0)

        # ==================================================
        # 🔥 SEXUAL (ABSOLUTE PRIORITY)
        # ==================================================

        sex_exp = sexual.get("sexual_explicit", 0.0)
        if sex_exp > sexual_safe:
            return True, "sexual_explicit", sex_exp

        sex_sug = sexual.get("sexual_suggestive", 0.0)
        if sex_sug > sexual_safe:
            return True, "sexual_suggestive", sex_sug

        # ==================================================
        # ⚠️ SCENE UNSAFE (DOMINANCE OVER SAFE)
        # ==================================================

        scene_candidates = {
            k: scene.get(k, 0.0)
            for k in ["violence", "weapon", "blood", "disturbing"]
        }

        # lấy category unsafe mạnh nhất
        top_scene_category = max(scene_candidates, key=scene_candidates.get)
        top_scene_score = scene_candidates[top_scene_category]

        if top_scene_score > scene_safe:
            return True, top_scene_category, top_scene_score

        # ==================================================
        # ✅ SAFE
        # ==================================================
        return False, "safe", max(sexual_safe, scene_safe)


    # =====================================================================
    # SIGNAL STRENGTH (UI / LOGGING)
    # =====================================================================

    def _signal_strength(self, confidence: float) -> str:
        if confidence >= 0.75:
            return "strong"
        if confidence >= 0.55:
            return "medium"
        if confidence >= 0.35:
            return "weak"
        return "none"


# Singleton
unsafe_scene_detector = UnsafeSceneDetector()


def ensure_unsafe_scene_detector_loaded():
    if not unsafe_scene_detector._instance_initialized:
        unsafe_scene_detector.initialize()
