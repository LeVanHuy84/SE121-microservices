# app/services/ai/text_moderation/moderation_aggregator.py

class ModerationAggregator:
    """
    Final decision layer (BINARY moderation).
    - PhoBERT: primary signal
    - Keyword: hard / sensitive
    """

    def __init__(self, phobert, keyword):
        self.phobert = phobert
        self.keyword = keyword
        self.model_threshold = 0.6

    def moderate(self, text: str) -> dict:
        # ===== keyword analysis (LUÔN chạy) =====
        kw = self.keyword.analyze(text)

        # ============================
        # HARD BLOCK (keyword)
        # ============================
        if kw.get("blocked"):
            return {
                "content": text,
                "isViolation": True,
                "violationScore": 1.0,
                "source": "keyword_hard",
                "flags": {},
                "sensitive": False,
            }

        # ============================
        # PhoBERT
        # ============================
        ph = self.phobert.infer(text)

        if ph.get("available"):
            score = ph["violation_score"]

            return {
                "content": text,
                "isViolation": score >= self.model_threshold,
                "violationScore": round(score, 4),
                "source": ph["model"],
                "flags": kw.get("flags", {}),
                "sensitive": bool(kw.get("flags")),
            }

        # ============================
        # Model unavailable → keyword only
        # ============================
        return {
            "content": text,
            "isViolation": False,
            "violationScore": 0.0,
            "source": "keyword_only",
            "flags": kw.get("flags", {}),
            "sensitive": bool(kw.get("flags")),
        }
