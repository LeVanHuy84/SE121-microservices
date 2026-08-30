# app/modules/analysis/services/ml_models/text_emotion/text_preprocessor.py
"""
Text Preprocessing Pipeline for PhoBERT Emotion Classification
- Social media noise cleaning (URLs, mentions, hashtags) via social_text_cleaner
- Teencode & Slang normalization via teencode_normalizer
- Vietnamese word segmentation (underthesea word_tokenize)
- Retains original Emojis natively for PhoBERT embedding
"""

import logging
from typing import Dict

from app.utils.text_cleaner import social_text_cleaner
from app.utils.teencode import teencode_normalizer

try:
    from underthesea import word_tokenize, sent_tokenize
    HAS_UNDERTHESEA = True
except ImportError:
    HAS_UNDERTHESEA = False

logger = logging.getLogger(__name__)


def preprocess_single_sentence(text: str, apply_word_tokenize: bool = True) -> str:
    """
    Clean, normalize teencode, and optionally apply underthesea word_tokenize.
    Emoji are natively preserved for PhoBERT.
    """
    # 1. Social Text Noise Cleaning (URLs, Mentions, Hashtags)
    text = social_text_cleaner.clean(text)

    # 2. Teencode & Slang Normalization
    text = teencode_normalizer.normalize(text)

    # 3. Vietnamese compound word segmentation (e.g. sầu riêng -> sầu_riêng)
    if HAS_UNDERTHESEA and apply_word_tokenize:
        try:
            text = word_tokenize(text, format="text")
        except Exception as e:
            logger.warning(f"underthesea word_tokenize failed: {e}")

    return " ".join(text.split())


def split_sentences(text: str) -> list[str]:
    """
    Split long text into sentences using underthesea.sent_tokenize.
    Filters out empty or single-character noise.
    """
    if not text or not text.strip():
        return []

    if HAS_UNDERTHESEA:
        try:
            sentences = sent_tokenize(text)
        except Exception as e:
            logger.warning(f"underthesea sent_tokenize failed: {e}")
            sentences = [text]
    else:
        # Fallback split on punctuation
        import re
        sentences = re.split(r'(?<=[.!?])\s+', text)

    cleaned_sentences = []
    for s in sentences:
        s_clean = s.strip()
        # Filter noise/super-short sentences (<2 chars)
        if len(s_clean) >= 2:
            cleaned_sentences.append(s_clean)

    return cleaned_sentences if cleaned_sentences else [text]
