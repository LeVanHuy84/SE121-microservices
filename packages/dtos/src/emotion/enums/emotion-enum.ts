export enum IntensityLevel {
  MILD = 'mild',
  MODERATE = 'moderate',
  SEVERE = 'severe',
}

export enum DominantModality {
  TEXT = 'text',
  IMAGE = 'image',
  //VIDEO = 'video',
}

export enum EmotionTimeWindow {
  ONE_DAY = '1d',
  SEVEN_DAYS = '7d',
  THIRTY_DAYS = '30d',
}

export enum LowCaseEmotion {
  HAPPY = 'happy',
  SAD = 'sad',
  ANGRY = 'angry',
  FEARFUL = 'fearful',
  DISGUSTED = 'disgusted',
  SURPRISED = 'surprised',
  NEUTRAL = 'neutral',
}

export enum RiskLevel {
  NORMAL = 'normal',
  WARNING = 'warning',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum RiskHintLevel {
  NONE = 'none',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}
