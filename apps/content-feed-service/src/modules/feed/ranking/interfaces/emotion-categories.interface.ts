/**
 * Emotion categories cho safety rules
 */

export const POSITIVE_EMOTIONS = ["joy", "surprise"] as const;

export const NEGATIVE_EMOTIONS = [
  "sadness",
  "anger",
  "fear",
  "disgust",
] as const;

export const NEUTRAL_EMOTIONS = ["neutral"] as const;

export const ALL_EMOTIONS = [
  ...POSITIVE_EMOTIONS,
  ...NEGATIVE_EMOTIONS,
  ...NEUTRAL_EMOTIONS,
] as const;

export type PositiveEmotion = (typeof POSITIVE_EMOTIONS)[number];
export type NegativeEmotion = (typeof NEGATIVE_EMOTIONS)[number];
export type NeutralEmotion = (typeof NEUTRAL_EMOTIONS)[number];
export type AllEmotion = (typeof ALL_EMOTIONS)[number];

/**
 * Helper functions
 */
export function isPositiveEmotion(emotion: string): boolean {
  return POSITIVE_EMOTIONS.includes(emotion as any);
}

export function isNegativeEmotion(emotion: string): boolean {
  return NEGATIVE_EMOTIONS.includes(emotion as any);
}

export function isNeutralEmotion(emotion: string): boolean {
  return NEUTRAL_EMOTIONS.includes(emotion as any);
}
