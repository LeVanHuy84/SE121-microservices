import { Injectable, Logger } from '@nestjs/common';
import {
  RankingCandidate,
  RankingContext,
  RankedItem,
} from '../interfaces/ranking-strategy.interface';
import { TrendingRankingStrategy } from '../strategies/trending-ranking.strategy';
import { PersonalRankingStrategy } from '../strategies/personal-ranking.strategy';
import { EmotionFeatureService } from './emotion-feature.service';
import { UserAffinityService } from 'src/modules/affinity/user-affinity.service';

/**
 * RankingService - Orchestrator cho ranking logic
 *
 * Nhiệm vụ:
 * - Chọn strategy phù hợp (trending/personal)
 * - Load user context (affinity, emotion features)
 * - Compute scores cho candidates
 * - Sort và return ranked items
 */
@Injectable()
export class RankingService {
  private readonly logger = new Logger(RankingService.name);

  constructor(
    private readonly trendingStrategy: TrendingRankingStrategy,
    private readonly personalStrategy: PersonalRankingStrategy,
    private readonly userAffinityService: UserAffinityService,
    private readonly emotionFeatureService: EmotionFeatureService,
  ) {}

  /**
   * Re-rank candidates cho Trending Feed
   */
  async rankForTrending(
    candidates: RankingCandidate[],
    emotion?: string,
  ): Promise<RankedItem[]> {
    if (!candidates.length) return [];

    const context: RankingContext = {
      query: { mainEmotion: emotion },
    };

    const scoredItems = await Promise.all(
      candidates.map(async (candidate) => {
        const finalScore = await this.trendingStrategy.computeScore(
          candidate,
          context,
        );

        return {
          ...candidate,
          finalScore,
        };
      }),
    );

    return scoredItems.sort((a, b) => b.finalScore - a.finalScore);
  }

  /** Re-rank candidates cho Personal Feed */
  async rankForPersonal(
    candidates: RankingCandidate[],
    userId: string,
  ): Promise<RankedItem[]> {
    if (!candidates.length) return [];

    // 1. Load user context (parallel)
    const [userAffinity, recentEmotions, emotionFeatures] = await Promise.all([
      this.userAffinityService.getUserAffinity(userId),
      this.userAffinityService.getRecentEmotions(userId, 20),
      this.emotionFeatureService.getEmotionFeatures(userId),
    ]);

    const context: RankingContext = {
      userId,
      userAffinity,
      recentEmotions,
      emotionFeatures: emotionFeatures || undefined,
    };

    // Log risk status
    if (emotionFeatures?.riskScore && emotionFeatures.riskScore > 0.7) {
      this.logger.warn(
        `High-risk user detected: ${userId} (risk=${emotionFeatures.riskScore.toFixed(2)}, streak=${emotionFeatures.negativeStreak})`,
      );
    }

    // 2. Compute scores in parallel
    const scoredItems = await Promise.all(
      candidates.map(async (candidate) => {
        const finalScore = await this.personalStrategy.computeScore(
          candidate,
          context,
        );

        // Optional: breakdown scores cho debug
        const featureScores = this.getFeatureBreakdown(candidate, context);

        return {
          ...candidate,
          finalScore,
          featureScores,
        };
      }),
    );

    // 3. Sort by final score
    return scoredItems.sort((a, b) => b.finalScore - a.finalScore);
  }

  /**
   * Debug helper: breakdown feature scores
   */
  private getFeatureBreakdown(
    candidate: RankingCandidate,
    context: RankingContext,
  ): Record<string, number> {
    const { snapshot, timestamp } = candidate;
    const { userAffinity, recentEmotions } = context;

    // Affinity score
    const emotion = snapshot.emotionFeature?.label;
    const affinity =
      emotion && userAffinity ? userAffinity[emotion] || 0.3 : 0.3;
    const intensity = snapshot.emotionFeature?.intensity || 0.5;
    const affinityScore = 1 + affinity * intensity;

    // Freshness score
    const hours = (Date.now() - timestamp.getTime()) / 3600000;
    const freshnessScore = Math.exp(-0.05 * hours);

    // Diversity penalty
    const count =
      emotion && recentEmotions
        ? recentEmotions.filter((e) => e === emotion).length
        : 0;
    const diversityPenalty = Math.pow(0.95, count);

    return {
      affinity: affinityScore,
      freshness: freshnessScore,
      diversity: diversityPenalty,
    };
  }

  /**
   * Track user view (update affinity + recent emotions)
   */
  async trackUserView(
    userId: string,
    postId: string,
    emotionLabel?: string,
    emotionScores?: Record<string, number>,
  ): Promise<void> {
    if (!emotionLabel) return;

    const signal =
      emotionScores && Object.keys(emotionScores).length > 0
        ? emotionScores
        : { [emotionLabel]: 1 };

    await Promise.all([
      this.userAffinityService.updateAffinity(userId, signal, 'view'),
      this.userAffinityService.trackViewedEmotion(userId, emotionLabel),
    ]);
  }

  /**
   * Track user interaction (like/comment/share)
   */
  async trackUserInteraction(
    userId: string,
    postId: string,
    emotionLabel: string,
    action: 'react' | 'comment' | 'share',
    emotionScores?: Record<string, number>,
  ): Promise<void> {
    const signal =
      emotionScores && Object.keys(emotionScores).length > 0
        ? emotionScores
        : { [emotionLabel]: 1 };
    await this.userAffinityService.updateAffinity(userId, signal, action);
  }
}
