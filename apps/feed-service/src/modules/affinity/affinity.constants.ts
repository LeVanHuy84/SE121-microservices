import { InteractionType } from '@repo/dtos';

/**
 * Default user affinity nếu user mới
 */
export const DEFAULT_USER_AFFINITY: Record<string, number> = {
  joy: 0.35,
  surprise: 0.25,
  love: 0.2,
  neutral: 0.1,
  sadness: 0.05,
  anger: 0.03,
  fear: 0.02,
} as const;

export const REDIS_KEYS = {
  USER_AFFINITY: (userId: string) => `user:${userId}:affinity`,
  USER_RECENT_EMOTIONS: (userId: string) => `user:${userId}:recent:emotions`,
} as const;

export const CACHE_TTL = {
  USER_AFFINITY: 7 * 24 * 3600, // 7 days
  RECENT_EMOTIONS: 7 * 24 * 3600, // 7 days
} as const;

/**
 * Interaction weights cho user affinity
 */
export const INTERACTION_WEIGHTS = {
  view: 0.1,
  react: 0.3,
  comment: 0.5,
  share: 0.7,
} as const;

export const INTERACTION_TO_WEIGHT_KEY: Record<
  InteractionType,
  keyof typeof INTERACTION_WEIGHTS
> = {
  [InteractionType.REACT]: 'react',
  [InteractionType.COMMENT]: 'comment',
  [InteractionType.SHARE]: 'share',
};
