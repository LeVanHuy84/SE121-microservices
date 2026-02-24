/**
 * User Emotion Profile - Emotional STATE tracking
 * Source: analysis-service (user's created content emotion analysis)
 */
export interface EmotionProfile {
  userId: string;

  // Long-term baseline (14-30 days EMA)
  baselineEmotion: string; // dominantBaselineEmotion
  baselineVector: Record<string, number>; // emotionVectorEMA

  // Risk tracking
  negativeStreak: number; // negativeStreakDays
  lastNegativeAt?: Date;
  riskScore: number; // 0-1

  totalAnalyses: number;
  updatedAt: Date;
}

/**
 * User Emotion Preference - Explicit user settings
 * Source: analysis-service (user manual config)
 */
export interface EmotionPreference {
  userId: string;

  preferredEmotions: string[]; // emotions user WANTS to see
  avoidedEmotions: string[]; // emotions user WANTS to avoid

  allowHealingContent: boolean; // show positive content when at-risk
  allowMentalAlert: boolean; // show alerts when risk high

  updatedAt: Date;
}

/**
 * Cached version cho Redis
 */
export interface CachedEmotionProfile extends Omit<
  EmotionProfile,
  'updatedAt' | 'lastNegativeAt'
> {
  updatedAt: string; // ISO string
  lastNegativeAt?: string; // ISO string
}

export interface CachedEmotionPreference extends Omit<
  EmotionPreference,
  'updatedAt'
> {
  updatedAt: string; // ISO string
}
