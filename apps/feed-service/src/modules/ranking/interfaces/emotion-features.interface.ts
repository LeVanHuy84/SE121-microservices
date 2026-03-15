/**
 * Emotion features consumed by feed ranking from analysis-service.
 */
export interface EmotionFeatures {
  userEmotionPreference: Record<string, number>;
  last24hEmotionDistribution: Record<string, number>;
  negativeRatio7d: number;
  emotionVolatility7d: number;
  riskScore: number;
  negativeStreak: number;
}

export interface EmotionFeaturesResponse {
  userId: string;
  features: EmotionFeatures;
}
