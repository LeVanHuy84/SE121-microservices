from enum import Enum

class Emotion(str, Enum):
    ANGRY = "angry"
    DISGUST = "disgust"
    FEAR = "fear"
    HAPPY = "happy"
    SAD = "sad"
    SURPRISE = "surprise"
    NEUTRAL = "neutral"


EMOTION_LIST = [
    Emotion.ANGRY,
    Emotion.DISGUST,
    Emotion.FEAR,
    Emotion.HAPPY,
    Emotion.SAD,
    Emotion.SURPRISE,
    Emotion.NEUTRAL,
]

EMOTION_MAPPING_TO_POST = {
    "happy": "JOY",
    "sad": "SADNESS",
    "angry": "ANGER",
    "fear": "FEAR",
    "disgust": "DISGUST",
    "surprise": "SURPRISE",
    "neutral": "NEUTRAL",
}
