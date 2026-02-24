import { PostSnapshot } from 'src/mongo/schema/post-snapshot.schema';
import { EmotionProfile, EmotionPreference } from './emotion-profile.interface';

/**
 * Candidate cho ranking (raw data)
 */
export interface RankingCandidate {
  postId: string;
  snapshot: PostSnapshot;
  baseScore: number; // từ distribution hoặc trending base
  timestamp: Date; // createdAt hoặc feedItem.createdAt
}

/**
 * Context cho ranking (user-specific, query params)
 */
export interface RankingContext {
  userId?: string;

  // ===== Layer 1: Interaction Preference (implicit) =====
  userAffinity?: Record<string, number>; // {joy: 0.75, anger: 0.1}
  recentEmotions?: string[]; // ['joy', 'surprise', 'joy', ...]

  // ===== Layer 2: Emotional State (from analysis-service) =====
  emotionProfile?: EmotionProfile; // user's emotional baseline & risk

  // ===== Layer 3: Explicit Preferences (from analysis-service) =====
  emotionPreference?: EmotionPreference; // user's explicit settings

  // ===== Query params =====
  query?: {
    mainEmotion?: string;
    limit?: number;
  };
}

/**
 * Kết quả sau khi ranked
 */
export interface RankedItem extends RankingCandidate {
  finalScore: number;
  featureScores?: Record<string, number>; // debug: {affinity: 1.5, freshness: 0.8}
}

/**
 * Interface cho ranking strategy
 */
export interface IRankingStrategy {
  /**
   * Compute final score cho 1 candidate
   */
  computeScore(
    candidate: RankingCandidate,
    context: RankingContext,
  ): Promise<number>;

  /**
   * Tên strategy (để logging/debug)
   */
  getName(): string;
}
