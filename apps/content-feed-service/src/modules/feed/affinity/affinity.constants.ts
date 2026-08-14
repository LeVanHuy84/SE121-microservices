import { InteractionType } from "@repo/dtos";

/**
 * Redis keys
 */
export const REDIS_KEYS = {
  CATEGORY: (userId: string) => `user:${userId}:affinity:category`,
  AUTHOR: (userId: string) => `user:${userId}:affinity:author`,
} as const;

/**
 * TTL
 */
export const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Explicit interaction weights
 */
export const INTERACTION_WEIGHTS: Record<string, number> = {
  [InteractionType.REACT]: 2,
  [InteractionType.COMMENT]: 3,
  [InteractionType.SHARE]: 4,

  // implicit
  view: 1,
  view_long: 1.5,
};

/**
 * View thresholds (ms)
 */
export const VIEW_THRESHOLDS = {
  MIN: 2000, // <2s → ignore
  LONG: 5000, // >=5s → view_long
} as const;

/**
 * Ranking weights
 */
export const AFFINITY_WEIGHT = {
  CATEGORY: 0.7,
  AUTHOR: 0.3,
} as const;
