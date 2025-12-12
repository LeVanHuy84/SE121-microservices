from enum import Enum

class EmotionEnum(str, Enum):
    JOY = 'joy'
    SADNESS = 'sadness'
    ANGER = 'anger'
    FEAR = 'fear'
    DISGUST = 'disgust'
    SURPRISE = 'surprise'
    NEUTRAL = 'neutral'