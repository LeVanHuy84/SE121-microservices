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
  JOY = 'joy',
  SADNESS = 'sadness',
  ANGER = 'anger',
  FEAR = 'fear',
  DISGUST = 'disgust',
  SURPRISE = 'surprise',
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

export enum InsightType {
  ABOVE_BASELINE = 'ABOVE_BASELINE',
  DETERIORATING_TREND = 'DETERIORATING_TREND',
  HIGH_NEGATIVITY = 'HIGH_NEGATIVITY',
  HIGH_RISK = 'HIGH_RISK',
  HIGH_VOLATILITY = 'HIGH_VOLATILITY',
  NEGATIVE_STREAK = 'NEGATIVE_STREAK',
  NORMALIZING = 'NORMALIZING',
  POSITIVE_STATE = 'POSITIVE_STATE',
  RECOVERING_TREND = 'RECOVERING_TREND',
  STABLE_STATE = 'STABLE_STATE',
}

export enum InsightTone {
  POSITIVE = 'positive',
  NEUTRAL = 'neutral',
  WARNING = 'warning',
  CRITICAL = 'critical',
}
