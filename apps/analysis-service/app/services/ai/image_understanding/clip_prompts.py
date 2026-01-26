# app/services/ai/image_understanding/clip_prompts.py

"""
CLIP Prompt Definitions
- Scene Safety (violence, weapon, blood, disturbing)
- Sexual Content
- Scene-level Emotion
"""

# ============================================================================
# SCENE SAFETY PROMPTS (NON-SEXUAL)
# ============================================================================

UNSAFE_PROMPTS = {
    "violence": [
        "a photo of a violent physical conflict",
        "people physically attacking each other",
        "a scene depicting assault or aggression",
    ],
    "weapon": [
        "a photo of a person holding a weapon",
        "guns or knives being used as weapons",
        "a dangerous weapon present in the scene",
    ],
    "blood": [
        "visible blood from an injury",
        "a scene showing bleeding wounds",
        "blood stains caused by violence",
    ],
    "disturbing": [
        "a disturbing or alarming scene",
        "a frightening and unsafe situation",
        "a scene that feels dangerous or threatening",
    ],
    "safe": [
        "a normal safe everyday scene",
        "a peaceful ordinary photo",
        "a harmless daily life image",
    ],
}


# ============================================================================
# SEXUAL CONTENT PROMPTS
# ============================================================================

SEXUAL_CONTENT_PROMPTS = {
    "sexual_explicit": [
        "an explicit sexual act",
        "graphic sexual activity",
        "explicit nudity in a sexual context",
    ],
    "sexual_suggestive": [
        "a sexually suggestive pose",
        "provocative body positioning",
        "a sensual but non explicit image",
    ],
    "safe": [
        "a normal non sexual image",
        "a fully clothed person in a normal scene",
        "a non suggestive everyday photo",
    ],
}


# ============================================================================
# SCENE-LEVEL EMOTION PROMPTS
# ============================================================================
# Used for scene-level emotion analysis (context, atmosphere, setting)
# NOT for face-level emotion (FER handles that)

EMOTION_PROMPTS = {
    "joy": [
        "a joyful and happy scene",
        "a cheerful and uplifting image",
        "a bright and positive atmosphere",
    ],
    "sadness": [
        "a sad and melancholic scene",
        "a somber and gloomy atmosphere",
        "a depressing or sorrowful image",
    ],
    "anger": [
        "an angry or intense scene",
        "a tense and aggressive atmosphere",
        "a hostile or confrontational image",
    ],
    "fear": [
        "a fearful or scary scene",
        "a threatening or ominous atmosphere",
        "an anxious or dangerous image",
    ],
    "surprise": [
        "a surprising or unexpected scene",
        "a dramatic or shocking image",
        "an astonishing or amazing atmosphere",
    ],
    "calm": [
        "a calm and peaceful scene",
        "a serene and tranquil atmosphere",
        "a relaxing and quiet image",
    ],
    "neutral": [
        "a neutral everyday scene",
        "a regular ordinary image",
        "a normal unremarkable atmosphere",
    ],
}


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_negative_semantic_prompts() -> dict:
    """
    Get all unsafe/violence prompts.
    
    Returns:
        Dictionary mapping category -> list of prompts
    """
    return UNSAFE_PROMPTS.copy()

def get_sexual_content_prompts() -> dict:
    """
    Get all sexual content prompts.
    
    Returns:
        Dictionary mapping category -> list of prompts
    """
    return SEXUAL_CONTENT_PROMPTS.copy()


def get_emotion_prompts() -> dict:
    """
    Get all scene-level emotion prompts.
    
    Returns:
        Dictionary mapping emotion -> list of prompts
    """
    return EMOTION_PROMPTS.copy()


def flatten_prompts(prompt_dict: dict) -> tuple:
    """
    Flatten prompt dictionary into (labels, texts) for CLIP.
    
    Args:
        prompt_dict: Dictionary mapping category -> list of prompts
        
    Returns:
        Tuple of (labels, prompt_texts)
        labels: List of category names
        prompt_texts: Flattened list of all prompt texts
    """
    labels = []
    texts = []
    
    for category, prompts in prompt_dict.items():
        for prompt in prompts:
            labels.append(category)
            texts.append(prompt)
    
    return labels, texts
