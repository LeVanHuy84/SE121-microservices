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
 */
export const EMOTION_MULTIPLIERS: Record<string, number> = {
  joy: 1.2, // funny/happy content thường viral
  surprise: 1.15,
  love: 1.1,
  neutral: 1.0,
  sadness: 0.9,
  anger: 0.85,
  fear: 0.8,
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
