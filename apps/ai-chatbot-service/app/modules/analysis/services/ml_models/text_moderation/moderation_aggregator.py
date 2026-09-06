from typing import Dict, Any


class ModerationAggregator:
    """
    Tier 3 Policy Decision Engine:
    Combines Tier 1 Hard Regex Keyword (Label 4: ILLEGAL_PORN)
    and Tier 2 PhoBERT Multi-class Model (Labels 0..3).

    Taxonomy & Policy Matrix:
      - Label 0: CLEAN -> Action: ALLOW (isViolation: False)
      - Label 1: PROFANITY_VENTING -> Action: ALLOW_WITH_WARNING (isViolation: False, maxSeverity: low)
      - Label 2: HATE_SPEECH -> Action: HARD_BLOCK (isViolation: True, maxSeverity: high)
      - Label 3: EMOTIONAL_CRISIS -> Action: ALLOW_WITH_SUPPORT (isViolation: False, maxSeverity: none, mentalHealthSupport: True)
      - Label 4: ILLEGAL_PORN (Regex) -> Action: HARD_BLOCK (isViolation: True, maxSeverity: high)
    """

    def __init__(self, phobert, keyword):
        self.phobert = phobert
        self.keyword = keyword

    def moderate(self, text: str) -> Dict[str, Any]:
        # ======================================================
        # TIER 1: FAST REGEX KEYWORD FILTER (< 1ms)
        # ======================================================
        kw = self.keyword.analyze(text)

        # Hard Block Hit: Label 4 (ILLEGAL_PORN)
        if kw.get("blocked"):
            return {
                "content": text,
                "isViolation": True,
                "action": "HARD_BLOCK",
                "label": "ILLEGAL_PORN",
                "labelCode": 4,
                "confidence": 1.0,
                "source": "keyword_regex_hard",
                "flags": {},
                "mentalHealthSupport": False,
                "reason": "Chứa nội dung khiêu dâm hoặc đồi trụy vi phạm tiêu chuẩn cộng đồng.",
                "flaggedCategories": ["ILLEGAL_PORN"],
                "allScores": {"ILLEGAL_PORN": 1.0}
            }

        # ======================================================
        # TIER 2: PHOBERT MULTI-CLASS AI INFERENCE
        # ======================================================
        ph = self.phobert.infer(text)

        if ph.get("available"):
            pred_label = ph["predicted_label"]
            label_code = ph["predicted_class_id"]
            confidence = ph["confidence"]
            all_scores = ph["all_scores"]

            # Map Label -> Policy Action
            if pred_label == "HATE_SPEECH":
                is_violation = True
                action = "HARD_BLOCK"
                mental_health_support = False
                reason = "Phát hiện ngôn từ thù ghét hoặc công kích cá nhân."
                flagged_cats = ["HATE_SPEECH"]
            elif pred_label == "PROFANITY_VENTING":
                is_violation = False
                action = "ALLOW_WITH_WARNING"
                mental_health_support = False
                reason = "Nội dung có chứa ngôn từ thô mộc xả stress."
                flagged_cats = ["PROFANITY_VENTING"]
            elif pred_label == "EMOTIONAL_CRISIS":
                is_violation = False
                action = "ALLOW_WITH_SUPPORT"
                mental_health_support = True
                reason = "Bày tỏ tâm trạng bế tắc/khủng hoảng cảm xúc."
                flagged_cats = ["EMOTIONAL_CRISIS"]
            else:  # CLEAN
                is_violation = False
                action = "ALLOW"
                mental_health_support = False
                reason = "Nội dung an toàn."
                flagged_cats = []

            return {
                "content": text,
                "isViolation": is_violation,
                "action": action,
                "label": pred_label,
                "labelCode": label_code,
                "confidence": confidence,
                "source": ph["model"],
                "flags": {},
                "mentalHealthSupport": mental_health_support,
                "reason": reason,
                "flaggedCategories": flagged_cats,
                "allScores": all_scores
            }

        # ======================================================
        # FALLBACK: MODEL UNAVAILABLE
        # ======================================================
        return {
            "content": text,
            "isViolation": False,
            "action": "ALLOW",
            "label": "CLEAN",
            "labelCode": 0,
            "confidence": 1.0,
            "source": "keyword_only",
            "flags": {},
            "mentalHealthSupport": False,
            "reason": "Nội dung an toàn.",
            "flaggedCategories": [],
            "allScores": {"CLEAN": 1.0}
        }



