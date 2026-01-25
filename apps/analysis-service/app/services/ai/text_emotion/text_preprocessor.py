# app/services/ai/text_emotion/text_preprocessor.py

"""
Text Preprocessing for Social Media Content
- Emoji normalization
- Slang mapping
- Repeated character reduction
"""

import re

# Emoji to Vietnamese meaning
EMOJI_MAP = {
    "😂": "vui",
    "🤣": "vui",
    "😭": "buồn",
    "😢": "buồn",
    "😡": "tức giận",
    "😠": "tức giận",
    "😱": "sợ hãi",
    "😐": "bình thường",
    "😒": "khó chịu",
    "🙂": "bình thường",
    "🙁": "buồn"
}

# Slang to normalized form
SLANG_MAP = {
    "vcl": "rất",
    "vl": "rất",
    "kk": "haha",
    "haha": "vui",
    "huhu": "buồn",
    ":))": "vui",
    ":(": "buồn",
    ":((": "buồn"
}


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

    # Emoji → word
    for emoji, meaning in EMOJI_MAP.items():
        if emoji in text:
            has_emoji = True
            text = text.replace(emoji, f" {meaning} ")

    # Slang normalization
    for slang, norm in SLANG_MAP.items():
        text = re.sub(rf"\b{slang}\b", norm, text, flags=re.IGNORECASE)

    # Remove repeated chars (vuiiiii → vui)
    text = re.sub(r"(.)\1{2,}", r"\1", text)

    # Cleanup whitespace
    text = re.sub(r"\s+", " ", text).strip()

    return {
        "text": text,
        "hasEmoji": has_emoji,
        "original": original
    }
