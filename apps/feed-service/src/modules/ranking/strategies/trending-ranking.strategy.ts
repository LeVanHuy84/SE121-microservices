import { Injectable, Logger } from '@nestjs/common';
import {
  IRankingStrategy,
  RankingCandidate,
  RankingContext,
} from '../interfaces/ranking-strategy.interface';
import {
  TRENDING_WEIGHTS,
  EMOTION_MULTIPLIERS,
  TRENDING_DECAY_LAMBDA,
} from '../ranking.constants';
import { EmotionFeatures } from '../interfaces/emotion-features.interface';
import {
  computeSharedEmotionalSafetyAdjustment,
  PostEmotionFeature,
} from './personal-ranking.strategy';

/**
 * Ranking strategy cho Trending Feed
 *
 * Formula:
 * finalScore = (engagement^0.4) × (freshness^0.2) × (emotionBoost^0.3) × (quality^0.1)
 */
@Injectable()
export class TrendingRankingStrategy implements IRankingStrategy {
  private readonly logger = new Logger(TrendingRankingStrategy.name);
  private readonly safetyStrength = {
    positiveBoost: 2.0,
    negativeSuppression: 0.5,
    streakPositiveBoost: 1.5,
    minAdjustment: 0.5,
    maxAdjustment: 2.0,
  } as const;

  getName(): string {
    return 'trending';
  }

  async computeScore(
    candidate: RankingCandidate,
    context: RankingContext,
  ): Promise<number> {
    const { snapshot, timestamp } = candidate;
    const { emotionFeatures } = context;

    const engagementScore = this.computeEngagement(snapshot.stats);
    const freshnessScore = this.computeFreshness(timestamp);
    const emotionBoost = this.computeEmotionBoost(snapshot.emotionFeature);
    const qualityScore = this.computeQuality(snapshot);

    const trendingScore =
      Math.pow(engagementScore, TRENDING_WEIGHTS.ENGAGEMENT) *
      Math.pow(freshnessScore, TRENDING_WEIGHTS.FRESHNESS) *
      Math.pow(emotionBoost, TRENDING_WEIGHTS.EMOTION) *
      Math.pow(qualityScore, TRENDING_WEIGHTS.QUALITY);

    const emotionalRelevance = this.computeEmotionalRelevance(
      snapshot.emotionFeature,
      emotionFeatures,
    );

    const emotionalStateAdjustment = computeSharedEmotionalSafetyAdjustment(
      snapshot.emotionFeature?.label,
      emotionFeatures,
      this.safetyStrength,
      this.logger,
    );

    const finalScore =
      trendingScore * emotionalRelevance * emotionalStateAdjustment;

    return finalScore;
  }

  /**
   * Engagement Score = log10(reactions×1 + comments×3 + shares×5 + 1)
   */
  private computeEngagement(
    stats: RankingCandidate['snapshot']['stats'],
  ): number {
    const total =
      (stats?.reactions || 0) * 1 +
      (stats?.comments || 0) * 3 +
      (stats?.shares || 0) * 5;

    return Math.log10(total + 1); // +1 tránh log(0)
  }

  /**
   * Freshness Score = 1 / (1 + λ × hours)
   * λ = 0.025 → half-life ~28 hours
   */
  private computeFreshness(timestamp: Date): number {
    const hours = (Date.now() - timestamp.getTime()) / 3600000;
    return 1 / (1 + TRENDING_DECAY_LAMBDA * hours);
  }

  /**
   * Emotion Boost Score = intensity × popularityMultiplier × confidence
   *
   * VD: Post joy với intensity=0.85, confidence=0.92
   *     → 0.85 × 1.2 × 0.92 = 0.938
   */
  private computeEmotionBoost(emotionFeature?: PostEmotionFeature): number {
    if (!emotionFeature) return 1.0;

    const { label, intensity, confidence } = emotionFeature;

    const baseIntensity = intensity || 0.5;
    const popularityMultiplier = EMOTION_MULTIPLIERS[label] || 1.0;
    const qualityFactor = confidence || 0.7;

    return baseIntensity * popularityMultiplier * qualityFactor;
  }

  private computeEmotionalRelevance(
    emotionFeature: PostEmotionFeature | undefined,
    features?: EmotionFeatures,
  ): number {
    if (!emotionFeature) return 1.0;

    const preference =
      features?.userEmotionPreference?.[emotionFeature.label] ?? 0;
    const intensity = emotionFeature.intensity ?? 0.5;

    return 1 + preference * intensity * 0.5;
  }

  /**
   * Quality Score = confidence×0.6 + hasMedia×0.3 + isSafe×0.1
   */
  private computeQuality(snapshot: RankingCandidate['snapshot']): number {
    const { emotionFeature, mediaPreviews } = snapshot;

    const confidenceScore = emotionFeature?.confidence || 0.5;
    const hasMedia = mediaPreviews?.length > 0 ? 0.3 : 0;
    const isSafe = emotionFeature?.riskHintLevel === 'low' ? 0.1 : 0;

    return confidenceScore * 0.6 + hasMedia + isSafe;
  }
}
