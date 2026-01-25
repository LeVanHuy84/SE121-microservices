# app/services/ai/text_emotion/text_sarcasm_detector.py

"""
Sarcasm Detection for Vietnamese Text
- Simple heuristic-based approach
- Detects positive words with negative context
"""

# Positive words
POSITIVE_WORDS = ["hay", "tốt", "đỉnh", "tuyệt"]

# Negative context indicators
NEGATIVE_CONTEXT = ["vãi", "vl", "thật sự", "luôn á", "ghê ha"]


def detect_sarcasm(text: str) -> bool:
    """
    Detect sarcasm in text using heuristics.
    
    Args:
        text: Text to analyze
        
    Returns:
        True if sarcasm detected, False otherwise
    """
    text_lower = text.lower()
    
    has_positive = any(p in text_lower for p in POSITIVE_WORDS)
    has_negative = any(n in text_lower for n in NEGATIVE_CONTEXT)
    
    return has_positive and has_negative
