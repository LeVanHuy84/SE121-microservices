import re
from typing import Dict, Set


class KeywordModerator:
    def __init__(self):
        # Tier 1: Hard Block (Nhãn 4: ILLEGAL_PORN - Cấm tuyệt đối, không phụ thuộc ngữ cảnh)
        self.illegal_porn_keywords: Set[str] = {
            # Sexual explicit / Pornography (Tiếng Anh & Viết tắt)
            "sex", "porn", "xxx", "xnxx", "xvideos", "xvideo",
            "nude", "naked", "erotic", "nsfw",
            "jav", "hentai", "onlyfans", "stripchat",
            "orgasm", "gangbang", "blowjob", "handjob",
            "cumshot", "pornhub", "redtube", "youporn",

            # Sexual explicit (Tiếng Việt)
            "địt nhau", "chịch nhau", "đụ nhau", "phịch nhau",
            "chịch", "đụ", "xoạc nhau", "nện nhau",
            "phim sex", "ảnh sex",
            "ảnh nude", "lộ clip sex", "show hàng",
            "hiếp dâm", "cưỡng hiếp", "loạn luân", "ấu dâm",
        }


        # Substring / Exact patterns for hard block explicit terms
        self.illegal_porn_exact_patterns = [
            re.compile(r'(?<!\w)' + re.escape(kw) + r'(?!\w)', re.IGNORECASE)
            for kw in self.illegal_porn_keywords
        ]

    def analyze(self, text: str) -> Dict:
        """
        Runs Tier 1 Fast Regex Keyword Filter (<1ms).
        Returns:
          - blocked: bool
          - label: str ("ILLEGAL_PORN" if blocked else "CLEAN")
          - label_code: int (4 if blocked else 0)
          - matchedKeywords: List[str]
          - flags: Dict[str, bool]
        """
        text_clean = text.strip()
        if not text_clean:
            return {
                "blocked": False,
                "label": "CLEAN",
                "label_code": 0,
                "matchedKeywords": [],
                "flags": {}
            }

        # 1. Check Hard Block (Label 4: ILLEGAL_PORN)
        matched_hard = []
        for kw, pattern in zip(self.illegal_porn_keywords, self.illegal_porn_exact_patterns):
            if pattern.search(text_clean):
                matched_hard.append(kw)

        if matched_hard:
            return {
                "blocked": True,
                "label": "ILLEGAL_PORN",
                "label_code": 4,
                "matchedKeywords": matched_hard,
                "flags": {}
            }

        return {
            "blocked": False,
            "label": "CLEAN",
            "label_code": 0,
            "flags": {},
            "matchedKeywords": []
        }


