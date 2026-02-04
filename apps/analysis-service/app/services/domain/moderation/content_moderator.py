# app/services/domain/moderation/content_moderator.py

"""
Domain Service: Content Moderation
- Pure business logic for moderation decisions
- Aggregates AI moderation results (text + image)
- Applies moderation policies
- No direct ML / AI dependencies
"""

import logging
from typing import Dict, Any, List

logger = logging.getLogger(__name__)


# ==================================================
# DOMAIN CONSTANTS
# ==================================================

SEVERITY_RANK = {
    "none": 0,
    "low": 1,
    "medium": 2,
    "high": 3,
}


# ==================================================
# DOMAIN HELPERS (POLICIES)
# ==================================================

def max_severity(severities: List[str]) -> str:
    """
    Return highest severity based on domain ranking.
    """
    if not severities:
        return "none"

    return max(severities, key=lambda s: SEVERITY_RANK.get(s, 0))


def text_severity(text_result: Dict[str, Any]) -> str:
    """
    Map text violation score to severity (domain policy).
    """
    score = float(text_result.get("violation_score", 0.0))

    if score >= 0.85:
        return "high"
    if score >= 0.65:
        return "medium"
    if score >= 0.5:
        return "low"
    return "none"


def image_violation_score(image_result: Dict[str, Any]) -> float:
    """
    Extract MAX non-safe score from image raw_scores.
    Domain rule:
    - NEVER use 'safe' score
    - If no non-safe signal → 0.0
    """
    unsafe = image_result.get("unsafe_details") or {}
    scores = unsafe.get("scores") or {}

    if not scores:
        return 0.0

    # Explicitly exclude safe
    non_safe_scores = [
        float(v)
        for k, v in scores.items()
        if k != "safe"
    ]

    if not non_safe_scores:
        return 0.0

    return max(non_safe_scores)


# ==================================================
# DOMAIN SERVICE
# ==================================================

class ContentModerator:
    """
    FINAL moderation decision.
    - No AI knowledge
    - No ML inference
    - Only business decision
    """

    def decide(
        self,
        text_result: Dict[str, Any] | None,
        image_results: List[Dict[str, Any]] | None,
    ) -> Dict[str, Any]:

        image_results = image_results or []

        # --------------------------------------------------
        # Detect violations
        # --------------------------------------------------

        text_violate = bool(text_result and text_result.get("is_violation"))

        violating_images = [
            img for img in image_results if img.get("is_violation")
        ]

        image_violate = bool(violating_images)
        is_violation = text_violate or image_violate

        if not is_violation:
            return {
                "is_violation": False,
                "violation_score": 0.0,
                "max_severity": "none",
            }

        # --------------------------------------------------
        # Aggregate scores & severities
        # --------------------------------------------------

        scores: List[float] = []
        severities: List[str] = []

        # ---------- TEXT ----------
        if text_violate:
            text_score = float(text_result.get("violation_score", 0.0))
            scores.append(text_score)
            severities.append(text_severity(text_result))

        # ---------- IMAGE ----------
        for img in violating_images:
            scores.append(image_violation_score(img))
            severities.append(img.get("severity", "none"))

        # --------------------------------------------------
        # FINAL DECISION
        # --------------------------------------------------

        return {
            "is_violation": True,
            "violation_score": round(max(scores), 4),
            "max_severity": max_severity(severities),
        }


# ==================================================
# Singleton instance (Application scope)
# ==================================================

content_moderator = ContentModerator()
