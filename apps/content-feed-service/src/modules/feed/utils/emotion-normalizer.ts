import { Emotion } from "@repo/dtos";
import {
  POSITIVE_EMOTIONS,
  NEGATIVE_EMOTIONS,
  NEUTRAL_EMOTIONS,
} from "../ranking/interfaces/emotion-categories.interface";

/**
 * Canonical lowercase emotion keys
 * Must match: joy, sadness, anger, fear, disgust, surprise, neutral
 */
export const CANONICAL_EMOTIONS = [
  ...POSITIVE_EMOTIONS,
  ...NEGATIVE_EMOTIONS,
  ...NEUTRAL_EMOTIONS,
] as const;

export type CanonicalEmotion = (typeof CANONICAL_EMOTIONS)[number];

/**
 * Normalize Emotion enum (uppercase) to lowercase string
 * Example: Emotion.JOY → "joy"
 */
export function normalizeEmotionEnum(emotion: Emotion | string): string {
  if (!emotion) return "";
  return emotion.toLowerCase();
}

/**
 * Normalize any emotion key string to lowercase
 * Validates against canonical emotion set
 * Example: "JOY" → "joy", "love" → (invalid, returns empty)
 */
export function normalizeEmotionKey(key: string | undefined): string {
  if (!key) return "";

  const normalized = key.toLowerCase();

  // Validate against canonical emotions
  if (!isCanonicalEmotion(normalized)) {
    console.warn(
      `Emotion key "${key}" is not canonical. Normalized to: "${normalized}"`,
    );
    // Still return normalized for logging, but caller should handle invalid emotion
  }

  return normalized;
}

/**
 * Normalize emotion distribution map
 * Converts keys to lowercase and filters out invalid emotions
 * Example: { "JOY": 0.8, "SADNESS": 0.1 } → { "joy": 0.8, "sadness": 0.1 }
 */
export function normalizeEmotionScores(
  scores: Record<string, number> | undefined,
): Record<string, number> {
  if (!scores || typeof scores !== "object") {
    return {};
  }

  const normalized: Record<string, number> = {};

  for (const [key, value] of Object.entries(scores)) {
    if (typeof value === "number" && isFinite(value)) {
      const lowercaseKey = key.toLowerCase();

      // Only include canonical emotions
      if (isCanonicalEmotion(lowercaseKey)) {
        normalized[lowercaseKey] = value;
      } else {
        console.warn(
          `Filtering out non-canonical emotion key: "${key}" (normalized: "${lowercaseKey}")`,
        );
      }
    }
  }

  return normalized;
}

/**
 * Normalize user affinity map
 * Example: { "JOY": 0.8, "love": 0.2 } → { "joy": 0.8 }
 * Removes non-canonical emotions and returns normalized affinity
 */
export function normalizeUserAffinity(
  affinity: Record<string, number> | undefined,
): Record<string, number> {
  if (!affinity || typeof affinity !== "object") {
    return {};
  }

  const normalized: Record<string, number> = {};
  let removedInvalidKeys = false;

  for (const [key, value] of Object.entries(affinity)) {
    if (typeof value === "number" && isFinite(value)) {
      const lowercaseKey = key.toLowerCase();

      if (isCanonicalEmotion(lowercaseKey)) {
        normalized[lowercaseKey] = Math.max(0, Math.min(1, value)); // Clamp to [0, 1]
      } else {
        console.warn(
          `Removing invalid emotion from affinity: "${key}" (normalized: "${lowercaseKey}")`,
        );
        removedInvalidKeys = true;
      }
    }
  }

  if (removedInvalidKeys) {
    console.warn(
      `Affinity had invalid keys removed. Normalized affinity:`,
      normalized,
    );
  }

  return normalized;
}

/**
 * Check if emotion is in canonical set
 */
export function isCanonicalEmotion(
  emotion: string | undefined,
): emotion is CanonicalEmotion {
  if (!emotion) return false;
  return CANONICAL_EMOTIONS.includes(emotion as any);
}

/**
 * Get safe emotion multiplier value
 * Returns 1.0 as fallback for unknown emotions
 */
export function getSafeEmotionMultiplier(
  emotionMultipliers: Record<string, number>,
  emotion: string | undefined,
  fallback: number = 1.0,
): number {
  if (!emotion) return fallback;

  const normalized = normalizeEmotionKey(emotion);
  const multiplier = emotionMultipliers[normalized];

  return multiplier ?? fallback;
}

/**
 * Ensure emotion key is lowercase and canonical
 * Used defensively before any emotion-based operations
 */
export function ensureCanonicalEmotion(emotion: string | undefined): string {
  if (!emotion) return "";

  const normalized = normalizeEmotionKey(emotion);

  if (!isCanonicalEmotion(normalized)) {
    console.error(
      `Critical: Non-canonical emotion encountered: "${emotion}" (normalized: "${normalized}")`,
    );
    return "";
  }

  return normalized;
}
