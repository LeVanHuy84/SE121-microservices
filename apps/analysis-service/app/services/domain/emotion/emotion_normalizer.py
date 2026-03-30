# app/services/domain/emotion/emotion_normalizer.py

"""
Domain Helper: Emotion Label Normalization
- Convert model-specific labels to standard EmotionEnum
"""

from app.enums.emotion_enum import EmotionEnum


# PhoBERT -> EmotionEnum
TEXT_LABEL_MAPPING = {
    "Anger": EmotionEnum.ANGER,
    "Disgust": EmotionEnum.DISGUST,
    "Enjoyment": EmotionEnum.JOY,
    "Fear": EmotionEnum.FEAR,
    "Sadness": EmotionEnum.SADNESS,
    "Surprise": EmotionEnum.SURPRISE,
    "Other": EmotionEnum.NEUTRAL,  # fallback
}

# CLIP/FER -> EmotionEnum
IMAGE_LABEL_MAPPING = {
    "angry": EmotionEnum.ANGER,
    "anger": EmotionEnum.ANGER,
    "disgust": EmotionEnum.DISGUST,
    "fear": EmotionEnum.FEAR,
    "happy": EmotionEnum.JOY,
    "joy": EmotionEnum.JOY,
    "sad": EmotionEnum.SADNESS,
    "sadness": EmotionEnum.SADNESS,
    "surprise": EmotionEnum.SURPRISE,
    "neutral": EmotionEnum.NEUTRAL,
}


def normalize_text_label(label: str) -> EmotionEnum:
    """
    Normalize text emotion label to EmotionEnum.
    
    Args:
        label: Label from text emotion model (e.g., PhoBERT)
        
    Returns:
        EmotionEnum value
    """
    return TEXT_LABEL_MAPPING.get(label, EmotionEnum.NEUTRAL)


def normalize_image_label(label: str) -> EmotionEnum:
    """
    Normalize image emotion label to EmotionEnum.
    
    Args:
        label: Label from image emotion model (e.g., CLIP, FER)
        
    Returns:
        EmotionEnum value
    """
    return IMAGE_LABEL_MAPPING.get(label.lower(), EmotionEnum.NEUTRAL)
