# app/services/ai/text_moderation/keyword_moderator.py

import re
from typing import Optional, Dict


class KeywordModerator:
    """
    High-recall keyword-based moderation.
    Used as hard / soft fallback when model confidence is low
    or when keywords are extremely explicit.
    """

    # =========================
    # 🔴 HARD BAN (always block)
    # =========================
    HARD_BAN_KEYWORDS = {
        # Toxic
        "địt", "đéo", "đụ", "đm", "dm", "vcl", "vl",
        "cc", "cặc", "lồn", "buồi", "cứt", "đĩ",
        "đ!t", "đ*o", "đ**", "djt", "dit",
        "dcm", "dmm", "vcc", "vãi cc", "vãi l",
        "clgt", "wtf", "đbrr", "xàm l",
        "xàm c", "như l", "như cc",
        "toxic vl", "rác vl",
        "fuck", "f*ck", "fck", "fk", "shit", "bullshit",
        "fucking", "mf", "motherfucker", "pussy", "bitch", "asshole",

        # Offensive
        "ngu", "ngu vl", "óc chó", "não chó",
        "đần", "thiểu năng", "não phẳng",
        "vô dụng", "rác rưởi", "phế vật",
        "idiot", "stupid", "dumb", "moron",
        "loser", "trash", "retarded",

        # Hate
        "bắc kỳ", "nam kỳ", "bắc kì", "nam kì", "parky",
        "nigger", "faggot", "chink", "raghead",

        # Sexual
        "chịch", "đụ", "dâm", "gạ tình",
        "làm tình", "địt nhau", "phang nhau", "vú",  "đít",
        "sex", "porn", "xxx", "xnxx",
        "nude", "naked", "jav", "hentai", "onlyfans",

        # Violence
        "giết", "chết", "đánh", "đập", "đâm", "chém",
        "kill", "murder", "stab", "shoot", "slaughter",

        # Self-harm
        "tự tử", "muốn chết", "chán sống",
        "không muốn sống", "kết liễu",
        "tự sát", "nhảy lầu",
        "uống thuốc ngủ", "cắt tay", "rạch tay","treo cổ",
        "muốn biến mất", "sống mệt quá",
        "suicide", "kill myself", "want to die",
        "end my life", "self harm", "cut myself",
    }

    # =========================
    # 🟠 SOFT BAN (model unsure)
    # =========================
    SOFT_BAN_KEYWORDS = {
        # --- Sexual / relationship (nhẹ, mập mờ) ---
        "qua đêm", "ngủ với", "ngủ chung",
        "make out", "sleep with", "hook up",
        "friends with benefits", "fwb",

        # --- Flirting / suggestive ---
        "thả thính", "gạ gẫm", "tán tỉnh",
        "mập mờ", "trên mức bạn bè",

        # --- Violence (không trực diện) ---
        "xử lý nó", "cho nó một bài học",
        "động tay động chân", "đánh", "dằn mặt",

        # --- Self-harm (cảm xúc tiêu cực nhưng chưa explicit) ---
        "mệt mỏi quá", "stress quá", "áp lực quá",
        "không ổn chút nào",

        # --- Drugs / risky behavior (nhẹ) ---
        "bay lắc", "phê", "chơi đồ",
        "đập đá", "high",
    }

    MODEL_CONFIDENCE_THRESHOLD = 0.6

    def __init__(self):
        self._hard_patterns = [
            re.compile(rf"\b{re.escape(k)}\b", re.IGNORECASE)
            for k in self.HARD_BAN_KEYWORDS
        ]
        self._soft_patterns = [
            re.compile(rf"\b{re.escape(k)}\b", re.IGNORECASE)
            for k in self.SOFT_BAN_KEYWORDS
        ]

    # =====================================================
    # 🔥 HARD / SOFT DECISION ONLY
    # =====================================================
    def check(
        self,
        text: str,
        model_confidence: float,
    ) -> Optional[Dict]:

        text = text.lower()

        # ---------- HARD BAN ----------
        for pattern in self._hard_patterns:
            if pattern.search(text):
                return self._violation(
                    confidence=0.99,
                    source="keyword_hard",
                )

        # ---------- SOFT BAN ----------
        if model_confidence < self.MODEL_CONFIDENCE_THRESHOLD:
            for pattern in self._soft_patterns:
                if pattern.search(text):
                    return self._violation(
                        confidence=0.5,
                        source="keyword_soft",
                    )

        return None

    def _violation(self, confidence: float, source: str) -> Dict:
        return {
            "is_violation": True,
            "confidence": confidence,
            "source": source,
        }