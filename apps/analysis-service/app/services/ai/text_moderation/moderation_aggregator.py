# app/services/ai/text_moderation/moderation_aggregator.py

class ModerationAggregator:
    """
    Final decision layer (BINARY moderation).
    - PhoBERT: primary signal
    - Keyword: hard / soft safety net
    """

    def __init__(self, phobert, keyword):
        self.phobert = phobert
        self.keyword = keyword

        # Threshold for model decision
        self.model_threshold = 0.6

    # =====================================================
    # Public API
    # =====================================================

    def moderate(self, text: str) -> dict:
        ph = self.phobert.infer(text)

        # ============================
        # CASE 1: Model available
        # ============================
        if ph.get("available"):
            score = ph["violation_score"]

            # 🔴 HARD keyword: luôn check
            kw_hard = self.keyword.check(
                text=text,
                model_confidence=1.0,  # ép cao để SOFT không chạy
            )
            if kw_hard and kw_hard["source"] == "keyword_hard":
                return kw_hard

            # 🟠 SOFT keyword: chỉ check khi model KHÔNG tự tin
            if score < self.model_threshold:
                kw_soft = self.keyword.check(
                    text=text,
                    model_confidence=score,
                )
                if kw_soft:
                    return kw_soft

            # 👉 Cuối cùng: model quyết
            return {
                "is_violation": score >= self.model_threshold,
                "confidence": round(score, 4),
                "source": ph["model"],
            }

        # ============================
        # CASE 2: Model unavailable
        # ============================
        kw_fallback = self.keyword.check(
            text=text,
            model_confidence=0.0,
        )

        if kw_fallback:
            return kw_fallback

        return self._allow("keyword_clean")


    # =====================================================
    # Helpers
    # =====================================================

    def _allow(self, source: str) -> dict:
        return {
            "is_violation": False,
            "confidence": 0.0,
            "source": source,
        }
