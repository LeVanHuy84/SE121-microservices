export const PROFILE_EMOTIONS = [
  'joy',
  'sadness',
  'anger',
  'fear',
  'disgust',
  'surprise',
  'neutral',
] as const;

export type ProfileEmotion = (typeof PROFILE_EMOTIONS)[number];

export type EmotionVector = Record<ProfileEmotion, number>;

export interface ProfileAggregateEvent {
  createdAt: Date;
  finalEmotion?: string;
  finalScores?: Record<string, number>;
}

export interface ProfileComputationResult {
  emotionVectorEMA: EmotionVector;
  recentNegativityScore: number;
  negativeEventStreak: number;
  lastEventAt?: Date;
  lastStrongNegativeAt?: Date;
  emotionMomentum: number;
}
