from app.enums.emotion_enum import EmotionEnum


TEXT_LABEL_MAPPING = {
    "Anger": EmotionEnum.ANGER,
    "Disgust": EmotionEnum.DISGUST,
    "Enjoyment": EmotionEnum.JOY,
    "Fear": EmotionEnum.FEAR,
    "Sadness": EmotionEnum.SADNESS,
    "Surprise": EmotionEnum.SURPRISE,
    "Other": EmotionEnum.NEUTRAL,  # fallback
}

# FER -> Enum
IMAGE_LABEL_MAPPING = {
    "angry": EmotionEnum.ANGER,
    "disgust": EmotionEnum.DISGUST,
    "fear": EmotionEnum.FEAR,
    "happy": EmotionEnum.JOY,
    "sad": EmotionEnum.SADNESS,
    "surprise": EmotionEnum.SURPRISE,
    "neutral": EmotionEnum.NEUTRAL,
}


def normalize_text_label(label: str) -> EmotionEnum:
    return TEXT_LABEL_MAPPING.get(label, EmotionEnum.NEUTRAL)


def normalize_image_label(label: str) -> EmotionEnum:
    return IMAGE_LABEL_MAPPING.get(label.lower(), EmotionEnum.NEUTRAL)
