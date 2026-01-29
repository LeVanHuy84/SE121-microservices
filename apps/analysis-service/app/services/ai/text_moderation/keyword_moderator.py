from typing import Dict, List


class KeywordModerator:
    def __init__(self):
        # Ban cứng: không cho publish
        self.banned_keywords = {
            # =====================
            # 🔞 Sexual explicit
            # =====================
            "sexual": [
                "sex", "porn", "xxx", "xnxx",
                "nude", "naked",
                "jav", "hentai", "onlyfans",
                "địt nhau", "chịch", "đụ",
            ],

            # =====================
            # 🤬 Profanity nặng (explicit)
            # =====================
            "toxic": [
                "địt", "đéo", "đụ",
                "cc", "cặc", "lồn", "buồi", "cứt", "đĩ",
                "đ!t", "đ*o", "đ**", "đbrr", "xàm l",
                "xàm c", "như l", "như cc",
                "fuck", "f*ck", "fck", "fk",
                "fucking", "motherfucker", "pussy", "bitch", "asshole",
            ],

            # =====================
            # 🎯 Offensive nặng (direct insult)
            # =====================
            "offensive": [
                "óc chó", "não chó",
                "thiểu năng",
                "retarded",
            ],

            # =====================
            # 🧨 Hate speech (zero tolerance)
            # =====================
            "hate_speech": [
                "nigger", "faggot",
                "chink", "raghead",
                "parky",
                "bắc kỳ", "nam kỳ",
                "bắc kì", "nam kì",
            ],
        }

        # Nội dung nhạy cảm: chỉ flag
        self.sensitive_keywords = {
            "self_harm": [
                "tự tử", "muốn chết", "chán sống",
                "không muốn sống", "kết liễu",
                "tự sát", "nhảy lầu",
                "uống thuốc ngủ", "cắt tay", "rạch tay", "treo cổ",
                "muốn biến mất", "sống mệt quá",
                "suicide", "kill myself", "want to die",
                "end my life", "self harm", "cut myself"
            ]
        }

    def analyze(self, text: str) -> Dict:
        text_lower = text.lower()

        flags: Dict[str, bool] = {}
        matched_keywords: Dict[str, List[str]] = {}

        # 1. Check banned keywords
        for category, keywords in self.banned_keywords.items():
            hits = [kw for kw in keywords if kw in text_lower]
            if hits:
                return {
                    "blocked": True,
                    "blockedCategory": category,
                    "matchedKeywords": hits,
                    "flags": {}
                }

        # 2. Check sensitive keywords (self-harm)
        for category, keywords in self.sensitive_keywords.items():
            hits = [kw for kw in keywords if kw in text_lower]
            if hits:
                flags[f"{category}_mention"] = True
                matched_keywords[category] = hits

        return {
            "blocked": False,
            "flags": flags,
            "matchedKeywords": matched_keywords
        }
