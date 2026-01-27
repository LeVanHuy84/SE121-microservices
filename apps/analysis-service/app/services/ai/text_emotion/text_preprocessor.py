# app/services/ai/text_emotion/text_preprocessor.py
"""
Text Preprocessing for Social Media Content
- Emoji normalization
- Slang mapping (word-based & symbol-based)
- Repeated character reduction
"""

import re
from typing import Dict


# Emoji to Vietnamese meaning
EMOJI_MAP: Dict[str, str] = {
    "😂": "vui",
    "🤣": "vui",
    "😭": "buồn",
    "😢": "buồn",
    "😡": "tức giận",
    "😠": "tức giận",
    "😱": "sợ hãi",
    "😐": "bình thường",
    "😒": "không hài lòng",
    "🙂": "bình thường",
    "🙁": "buồn",
}

# Slang dạng từ (dùng word boundary)
WORD_SLANG_MAP: Dict[str, str] = {
    "vcl": "rất",
    "vl": "rất",
    "kk": "haha",
    "haha": "vui",
    "huhu": "buồn",
}

# Slang dạng ký hiệu / symbol (KHÔNG dùng \b)
SYMBOL_SLANG_MAP: Dict[str, str] = {
    ":))": "vui",
    ":(": "buồn",
    ":((": "buồn",
}

# Pre-compile regex (performance + safety)
WORD_SLANG_PATTERN = re.compile(
    r"\b(" + "|".join(map(re.escape, WORD_SLANG_MAP.keys())) + r")\b",
    flags=re.IGNORECASE,
)

SYMBOL_SLANG_PATTERN = re.compile(
    "|".join(map(re.escape, SYMBOL_SLANG_MAP.keys()))
)

REPEAT_CHAR_PATTERN = re.compile(r"(.)\1{2,}")
WHITESPACE_PATTERN = re.compile(r"\s+")


def normalize_text(text: str) -> dict:
    """
    Normalize social media text.

    Args:
        text: Raw text content

    Returns:
        {
            "text": normalized text,
            "hasEmoji": bool,
            "original": original text
        }
    """
    original = text
    has_emoji = False

    # 1. Emoji → word
    for emoji, meaning in EMOJI_MAP.items():
        if emoji in text:
            has_emoji = True
            text = text.replace(emoji, f" {meaning} ")

    # 2. Word slang normalization (vcl, vl, kk...)
    def replace_word_slang(match: re.Match) -> str:
        slang = match.group(1).lower()
        return WORD_SLANG_MAP.get(slang, slang)

    text = WORD_SLANG_PATTERN.sub(replace_word_slang, text)

    # 3. Symbol slang normalization (:)), :( ...)
    def replace_symbol_slang(match: re.Match) -> str:
        slang = match.group(0)
        return f" {SYMBOL_SLANG_MAP.get(slang, slang)} "

    text = SYMBOL_SLANG_PATTERN.sub(replace_symbol_slang, text)

    # 4. Remove repeated characters (vuiiiii → vui)
    text = REPEAT_CHAR_PATTERN.sub(r"\1", text)

    # 5. Cleanup whitespace
    text = WHITESPACE_PATTERN.sub(" ", text).strip()

    return {
        "text": text,
        "hasEmoji": has_emoji,
        "original": original,
    }
