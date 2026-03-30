# app/services/ai/image_understanding/clip_prompts.py

"""
CLIP Moderation & Emotion Prompts
- ONE prompt space for moderation (sexual + violence + safe)
- Emotion prompts separated (multiclass)
"""

# ============================================================================
# MODERATION PROMPTS (ONE-SHOT MULTICLASS)
# ============================================================================

CLIP_MODERATION_PROMPTS = {
    "sexual": [
        "sexual or erotic content involving nudity or sexual acts",
        "pornographic or sexually explicit image",
        "suggestive sexual content intended to arouse"
    ],

    "violence": [
        "people physically attacking each other",
        "a violent fight causing harm",
        "assault or physical aggression"
    ],

    "weapon": [
        "a person holding a gun or knife",
        "visible weapon used to threaten others",
        "dangerous weapon in a violent context"
    ],

    "blood": [
        "visible blood from an injury",
        "bleeding wound on a person",
        "blood stains caused by violence"
    ],

    "disturbing": [
        "a frightening or disturbing violent scene",
        "a dangerous threatening situation",
        "an alarming unsafe scene"
    ],

    "safe": [
        "a normal everyday photo with people fully clothed",
        "a peaceful non violent daily life scene",
        "a harmless ordinary image with no sexual or violent content"
    ],
}

# ============================================================================
# SCENE-LEVEL EMOTION PROMPTS (SEPARATE TASK)
# ============================================================================

EMOTION_PROMPTS = {
    "anger": [
        "an angry or aggressive scene",
        "a tense hostile confrontation",
    ],
    "disgust": [
        "a disgusting or repulsive scene",
        "something causing strong disgust",
    ],
    "fear": [
        "a fearful or threatening scene",
        "a scary dangerous atmosphere",
    ],
    "joy": [
        "a joyful happy scene",
        "a cheerful uplifting moment",
    ],
    "sadness": [
        "a sad melancholic scene",
        "a gloomy depressing atmosphere",
    ],
    "surprise": [
        "a surprising unexpected moment",
        "a shocking dramatic scene",
    ],
    "neutral": [
        "a neutral everyday scene",
        "a calm peaceful ordinary situation",
        "a normal unremarkable image",
    ],
}


# ============================================================================
# HELPERS
# ============================================================================

def flatten_prompts(prompt_dict: dict) -> tuple[list[str], list[str]]:
    labels, texts = [], []
    for label, prompts in prompt_dict.items():
        for p in prompts:
            labels.append(label)
            texts.append(p)
    return labels, texts
