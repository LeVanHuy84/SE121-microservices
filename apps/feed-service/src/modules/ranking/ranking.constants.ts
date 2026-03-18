/**
 * Trọng số cho Trending Ranking
 */
export const TRENDING_WEIGHTS = {
  ENGAGEMENT: 0.4,
  FRESHNESS: 0.2,
  EMOTION: 0.3,
  QUALITY: 0.1,
} as const;

/**
 * Emotion popularity multipliers (dựa trên viral potential)
 * CANONICAL EMOTIONS ONLY: joy, sadness, anger, fear, disgust, surprise, neutral
 */
export const EMOTION_MULTIPLIERS: Record<string, number> = {
  joy: 1.2, // funny/happy content thường viral
  surprise: 1.15,
  neutral: 1.0,
  sadness: 0.9,
  anger: 0.85,
  disgust: 0.8,
  fear: 0.75,
};

/**
 * Time decay lambda cho trending
 * 0.025 → half-life ~28 hours
 */
export const TRENDING_DECAY_LAMBDA = 0.025;

/**
 * Time decay rate cho personal feed
 * 0.05 → sau 24h = ~0.3
 */
export const PERSONAL_DECAY_RATE = 0.05;

/**
 * Diversity penalty base (giảm 5% mỗi lần thấy emotion trùng)
 */
export const DIVERSITY_PENALTY_BASE = 0.95;

/**
 * Cosine-similarity diversity penalty config.
 * diversityFactor = clamp(1 - weight * similarity, min, max)
 */
export const EMOTION_DIVERSITY_WEIGHT = 0.25;
export const EMOTION_DIVERSITY_MIN = 0.75;
export const EMOTION_DIVERSITY_MAX = 1.05;

/**
 * Confidence calibration config.
 * confidenceWeight = sigmoid(k * (confidence - midpoint))
 */
export const CONFIDENCE_SIGMOID_FACTOR = 8;
export const CONFIDENCE_SIGMOID_MIDPOINT = 0.5;

/**
 * Post-level risk hint multiplier.
 */
export const RISK_HINT_MULTIPLIERS: Record<string, number> = {
  low: 1.05,
  medium: 1.0,
  high: 0.85,
  critical: 0.65,
};

/**
 * Additional suppression when user is high-risk and post risk is high/critical.
 */
export const HIGH_RISK_EXTRA_SUPPRESSION = 0.85;

/**
 * Modality reliability multipliers.
 */
export const MODALITY_WEIGHTS: Record<string, number> = {
  text: 1.0,
  image: 0.9,
};

/**
 * Scene-aware personalization config.
 */
export const SCENE_AFFINITY_WEIGHT = 0.15;
export const SCENE_AFFINITY_MIN = 0.9;
export const SCENE_AFFINITY_MAX = 1.15;

/**
 * Redis key patterns
 */
export const REDIS_KEYS = {
  USER_AFFINITY: (userId: string) => `user:${userId}:affinity`,
  USER_RECENT_EMOTIONS: (userId: string) => `user:${userId}:recent:emotions`,
  POST_EMOTION_SCORE: (emotion: string) =>
    `post:emotion:${emotion.toLowerCase()}:score`,
  POST_META: (postId: string) => `post:meta:${postId}`,
} as const;

/**
 * TTLs
 */
export const CACHE_TTL = {
  RECENT_EMOTIONS: 7 * 24 * 3600, // 7 days
  POST_META: 30 * 24 * 3600, // 30 days
} as const;
