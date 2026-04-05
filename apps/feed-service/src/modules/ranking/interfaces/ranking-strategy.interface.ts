import { PostSnapshot } from 'src/mongo/schema/post-snapshot.schema';
import { EmotionFeatures } from './emotion-features.interface';

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

  // ===== Layer 2: Emotional Features (from analysis-service) =====
  emotionFeatures?: EmotionFeatures;

  // ===== Query params =====
  query?: {
    mainEmotion?: string;
    limit?: number;
  };
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
