import re
from typing import Dict, List, Tuple

# Emotion Cues & Keywords (English)
EMOTION_KEYWORDS = {
    "Anger": {"fuck", "shit", "motherfucker", "bitch", "bastard", "idiot", "stupid", "hate", "mad", "furious", "pissed", "bullshit", "rage", "damn", "wtf", "hell"},
    "Fear": {"scared", "afraid", "terrified", "fear", "worried", "panic", "anxious", "creepy", "horrifying", "nightmare", "frightened"},
    "Disgust": {"gross", "disgusting", "nasty", "revolting", "vile", "sick", "yuck", "eww", "repulsive", "trash"},
    "Surprise": {"wow", "omg", "shocked", "surprised", "unbelievable", "woah", "amazing", "unexpected", "holy", "insane"}
}

# Idioms & Sarcasm Cues
IDIOM_PATTERNS = [
    r"\bpot calling the kettle\b",
    r"\bfly high\b",
    r"\bliving (his|her|their|its) best\b",
    r"\bpiece of cake\b",
    r"\bbite the bullet\b",
    r"\bbreak a leg\b"
]

PROFANITY_SLANG = {"fuck", "fucking", "shit", "motherfucker", "bitch", "bastard", "wtf", "stfu", "gtfo", "crap", "asshole", "troll"}


def compute_translation_signals(eng_text: str, viet_text: str) -> Dict[str, float]:
    """Compute surface-level translation quality signals."""
    signals = {}
    eng_words = eng_text.split()
    viet_words = viet_text.split()
    
    # 1. Ratio check
    len_eng = max(len(eng_words), 1)
    len_viet = len(viet_words)
    ratio = len_viet / len_eng
    signals["len_ratio_abnormal"] = 1.0 if (ratio < 0.4 or ratio > 2.5) else 0.0

    # 2. Placeholder corruption
    eng_has_name = bool(re.search(r"\[NAME\]|\[TÊN\]", eng_text, re.I))
    viet_has_name = bool(re.search(r"\[TÊN\]|\[NAME\]", viet_text, re.I))
    signals["placeholder_corrupted"] = 1.0 if (eng_has_name and not viet_has_name) else 0.0

    # 3. Untranslated English fragments (e.g. keeping English words in output)
    eng_unique = set(w.lower().strip(",.!?") for w in eng_words if len(w) > 3)
    viet_lower = viet_text.lower()
    untranslated = [w for w in eng_unique if w in viet_lower and w not in ["tên", "user", "http"]]
    signals["untranslated_ratio"] = len(untranslated) / max(len(eng_unique), 1)

    # 4. Word repetition bug
    words = viet_text.lower().split()
    reps = sum(1 for i in range(len(words) - 1) if words[i] == words[i + 1])
    signals["repetition_bug"] = 1.0 if reps >= 2 else 0.0

    return signals


def compute_linguistic_difficulty(eng_text: str) -> Dict[str, float]:
    """Detect linguistic complexities in source English sentence."""
    text_lower = eng_text.lower()
    words = set(re.findall(r"\b\w+\b", text_lower))
    
    has_profanity = len(words.intersection(PROFANITY_SLANG)) > 0
    has_idiom = any(re.search(p, text_lower) for p in IDIOM_PATTERNS)
    has_sarcasm = bool(re.search(r"/s\b|\bobviously\b|\byeah right\b|\boh sure\b", text_lower))
    has_all_caps = bool(re.search(r"\b[A-Z]{3,}\b", eng_text))
    
    return {
        "has_profanity": 1.0 if has_profanity else 0.0,
        "has_idiom": 1.0 if has_idiom else 0.0,
        "has_sarcasm": 1.0 if has_sarcasm else 0.0,
        "has_all_caps": 1.0 if has_all_caps else 0.0
    }


def compute_risk_score(eng_text: str, viet_text: str, target_emotion: str) -> Tuple[float, str, Dict]:
    """Calculate overall risk score [0, 100] and risk category."""
    trans_signals = compute_translation_signals(eng_text, viet_text)
    ling_signals = compute_linguistic_difficulty(eng_text)
    
    score = 0.0

    # High penalties for translation corruption
    if trans_signals["placeholder_corrupted"]:
        score += 40.0
    if trans_signals["repetition_bug"]:
        score += 35.0
    if trans_signals["len_ratio_abnormal"]:
        score += 25.0
    score += trans_signals["untranslated_ratio"] * 30.0

    # Penalties for linguistic difficulty (Profanity/Idioms/Sarcasm often degraded by MarianMT)
    if ling_signals["has_idiom"]:
        score += 50.0
    if ling_signals["has_sarcasm"]:
        score += 45.0
    if ling_signals["has_profanity"]:
        score += 35.0

    score = min(score, 100.0)

    if score < 15.0:
        category = "LOW_RISK"
    elif score < 45.0:
        category = "MEDIUM_RISK"
    else:
        category = "HIGH_RISK"


    details = {**trans_signals, **ling_signals}
    return score, category, details
