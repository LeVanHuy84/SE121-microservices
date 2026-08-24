# app/modules/analysis/services/ml_models/text_emotion/text_preprocessor.py
"""
Text Preprocessing Pipeline for PhoBERT Emotion Classification
- Social media noise cleaning (URLs, mentions, hashtags, diacritics)
- Teencode & Slang normalization via ViSoLex dictionary
- Emoji normalization
- Repeated character reduction
"""

import re
from typing import Dict

from app.utils.text_cleaner import social_text_cleaner
from app.utils.teencode import teencode_normalizer


# Emoji to Vietnamese emotion meaning
EMOJI_MAP = {
    # 😂 Vui / tích cực
    "😂": "vui",
    "🤣": "vui",
    "😄": "vui",
    "😁": "vui",
    "😆": "vui",
    "😊": "vui",
    "🙂": "bình thường",
    "😋": "vui",
    "😌": "dễ chịu",

    # 😍 Yêu thích / tình cảm
    "😍": "yêu thích",
    "🥰": "yêu thích",
    "😘": "yêu thích",
    "😗": "yêu thích",
    "😙": "yêu thích",
    "💖": "yêu thích",
    "❤️": "yêu thích",
    "💕": "yêu thích",

    # 🤩 Phấn khích / hype
    "🤩": "phấn khích",
    "🥳": "phấn khích",
    "🎉": "phấn khích",

    # 😎 Tự tin / cool
    "😎": "tự tin",
    "😏": "mỉa mai",

    # 😢 Buồn
    "😭": "buồn",
    "😢": "buồn",
    "😔": "buồn",
    "😞": "buồn",
    "🙁": "buồn",
    "☹️": "buồn",
    "😣": "buồn",
    "😖": "buồn",
    "🥲": "buồn nhẹ",

    # 😩 Mệt mỏi / stress
    "😫": "mệt mỏi",
    "😩": "mệt mỏi",
    "😓": "mệt mỏi",
    "😪": "buồn ngủ",

    # 😡 Tức giận
    "😡": "tức giận",
    "😠": "tức giận",
    "🤬": "tức giận",
    "👿": "tức giận",
    "😤": "khó chịu",

    # 😲 Ngạc nhiên / sốc
    "😲": "ngạc nhiên",
    "😮": "ngạc nhiên",
    "😯": "ngạc nhiên",
    "😳": "bất ngờ",
    "🤯": "sốc",

    # 😨 Sợ hãi / lo lắng
    "😱": "sợ hãi",
    "😨": "lo lắng",
    "😰": "lo lắng",
    "😥": "lo lắng",

    # 😒 Thái độ tiêu cực nhẹ
    "😒": "không hài lòng",
    "🙄": "chán nản",
    "😑": "bất lực",
    "🤨": "nghi ngờ",

    # 😐 Trung tính
    "😐": "bình thường",
    "😶": "bình thường",
    "🫥": "bình thường",

    # 🤔 Suy nghĩ / unsure
    "🤔": "suy nghĩ",
    "🧐": "suy xét",
}

# Slang dạng ký hiệu / symbol (KHÔNG dùng \b)
SYMBOL_SLANG_MAP: Dict[str, str] = {
    ":))": "vui",
    ":(": "buồn",
    ":((": "buồn",
    "=(((": "buồn",
}

SYMBOL_SLANG_PATTERN = re.compile(
    "|".join(map(re.escape, SYMBOL_SLANG_MAP.keys()))
)

REPEAT_CHAR_PATTERN = re.compile(r"(.)\1{2,}")
WHITESPACE_PATTERN = re.compile(r"\s+")


def normalize_text(text: str) -> dict:
    """
    Normalize social media text specifically for PhoBERT Emotion Model.

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

    # 1. Social Text Noise Cleaning (URLs, Mentions, Hashtags, Diacritics)
    text = social_text_cleaner.clean(text)

    # 2. Teencode & Slang Normalization (ViSoLex dictionary)
    text = teencode_normalizer.normalize(text)

    # 3. Emoji → word mapping
    for emoji, meaning in EMOJI_MAP.items():
        if emoji in text:
            has_emoji = True
            text = text.replace(emoji, f" {meaning} ")

    # 4. Symbol slang normalization (:)), :( ...)
    def replace_symbol_slang(match: re.Match) -> str:
        slang = match.group(0)
        return f" {SYMBOL_SLANG_MAP.get(slang, slang)} "

    text = SYMBOL_SLANG_PATTERN.sub(replace_symbol_slang, text)

    # 5. Remove repeated characters (vuiiiii → vui)
    text = REPEAT_CHAR_PATTERN.sub(r"\1", text)

    # 6. Cleanup whitespace
    text = WHITESPACE_PATTERN.sub(" ", text).strip()

    return {
        "text": text,
        "hasEmoji": has_emoji,
        "original": original,
    }
