# app/services/ai/text_emotion/language_detector.py

import re
from langdetect import detect, DetectorFactory, LangDetectException

DetectorFactory.seed = 0

VI_DIACRITIC_RE = re.compile(
    r"[àáạảãâầậẩẫăằắặẳẵ"
    r"èéẹẻẽêềếệểễ"
    r"ìíịỉĩ"
    r"òóọỏõôồốộổỗơờớợởỡ"
    r"ùúụủũưừứựửữ"
    r"ỳýỵỷỹđ]",
    re.IGNORECASE,
)


def has_vietnamese_diacritics(text: str) -> bool:
    return bool(VI_DIACRITIC_RE.search(text))


def detect_language(text: str) -> str | None:
    """
    Language detection rules:
    - <= 2 words  → skip (return None)
    - Vietnamese diacritics → vi (fast-path)
    - else → langdetect
    """
    if not text:
        return None

    words = text.strip().split()
    if len(words) <= 2:
        return None

    # Vietnamese override
    if has_vietnamese_diacritics(text):
        return "vi"

    try:
        return detect(text)
    except LangDetectException:
        return None
