import { Injectable, Logger } from '@nestjs/common';
import {
  IRankingStrategy,
  RankingCandidate,
  RankingContext,
} from '../interfaces/ranking-strategy.interface';
import {
  PERSONAL_DECAY_RATE,
  DIVERSITY_PENALTY_BASE,
} from '../ranking.constants';
import {
  isPositiveEmotion,
  isNegativeEmotion,
} from '../interfaces/emotion-categories.interface';

/**
 * Ranking strategy cho Personal Feed
 *
 * Formula (Enhanced):
 * finalScore = baseScore × affinityMultiplier × emotionalStateAdjustment ×
 *              freshnessDecay × diversityPenalty × engagementBoost
 */
@Injectable()
export class PersonalRankingStrategy implements IRankingStrategy {
  private readonly logger = new Logger(PersonalRankingStrategy.name);

  getName(): string {
    return 'personal';
  }

  async computeScore(
    candidate: RankingCandidate,
    context: RankingContext,
  ): Promise<number> {
    const { snapshot, baseScore, timestamp } = candidate;
    const { userAffinity, recentEmotions, emotionProfile, emotionPreference } =
      context;

    const affinityMultiplier = this.computeAffinityMultiplier(
      snapshot.emotionFeature,
      userAffinity,
    );

    // ⭐ NEW: Emotional state adjustment (content safety)
    const emotionalStateAdjustment = this.computeEmotionalStateAdjustment(
      snapshot.emotionFeature?.label,
      emotionProfile,
      emotionPreference,
    );

    const freshnessDecay = this.computeFreshnessDecay(timestamp);

    const diversityPenalty = this.computeDiversityPenalty(
      snapshot.emotionFeature?.label,
      recentEmotions,
    );

    const engagementBoost = this.computeEngagementBoost(snapshot.stats);

    const finalScore =
      baseScore *
      affinityMultiplier *
      emotionalStateAdjustment *
      freshnessDecay *
      diversityPenalty *
      engagementBoost;

    return finalScore;
  }

  /**
   * Affinity Multiplier = 1 + (userAffinity[emotion] × intensity)
   *
   * VD: User affinity[joy]=0.75, post intensity=0.9
   *     → 1 + (0.75 × 0.9) = 1.675 (boost 67.5%)
   */
  private computeAffinityMultiplier(
    emotionFeature?: any,
    userAffinity?: Record<string, number>,
  ): number {
    if (!emotionFeature || !userAffinity) return 1.0;

    const emotion = emotionFeature.label;
    const affinity = userAffinity[emotion] || 0.3; // default neutral
    const intensity = emotionFeature.intensity || 0.5;

    return 1 + affinity * intensity;
  }

  /**
   * Freshness Decay = exp(-rate × hours)
   * rate = 0.05 → sau 24h = ~0.3
   */
  private computeFreshnessDecay(timestamp: Date): number {
    const hours = (Date.now() - timestamp.getTime()) / 3600000;
    return Math.exp(-PERSONAL_DECAY_RATE * hours);
  }

  /**
   * Diversity Penalty = 0.95^count
   *
   * VD: Đã xem 5 bài 'joy' gần đây
   *     → 0.95^5 = 0.77 (giảm 23%)
   */
  private computeDiversityPenalty(
    emotion?: string,
    recentEmotions?: string[],
  ): number {
    if (!emotion || !recentEmotions) return 1.0;

    const count = recentEmotions.filter((e) => e === emotion).length;
    return Math.pow(DIVERSITY_PENALTY_BASE, count);
  }

  /**
   * Engagement Boost = 1 + log10(totalEngagement + 1) × 0.1
   */
  private computeEngagementBoost(stats: any): number {
    const total =
      (stats?.reactions || 0) +
      (stats?.comments || 0) * 2 +
      (stats?.shares || 0) * 3;

    return 1 + Math.log10(total + 1) * 0.1;
  }

  /**
   * ⭐ Emotional State Adjustment - Content Safety Algorithm
   *
   * Prevent negative spiral khi user at-risk:
   * - High risk (>0.7) → boost positive 2.5x, suppress negative 0.3x
   * - Negative streak (>3 days) → gradual boost positive
   * - Preferred emotions → extra boost 1.3x
   * - Healing mode → extra boost positive 1.5x
   */
  private computeEmotionalStateAdjustment(
    postEmotion?: string,
    profile?: any,
    preference?: any,
  ): number {
    if (!postEmotion) return 1.0;

    let adjustment = 1.0;

    // ===== 1. High-risk intervention =====
    if (profile?.riskScore > 0.7) {
      if (isPositiveEmotion(postEmotion)) {
        adjustment *= 2.5; // strongly boost positive
        this.logger.debug(
          `High-risk user: boosting positive content (${postEmotion})`,
        );
      } else if (isNegativeEmotion(postEmotion)) {
        adjustment *= 0.3; // strongly suppress negative
        this.logger.debug(
          `High-risk user: suppressing negative content (${postEmotion})`,
        );
      }
    }

    // ===== 2. Negative streak recovery =====
    else if (profile?.negativeStreak > 3) {
      const boostFactor = Math.min(profile.negativeStreak / 7, 1.0);
      if (isPositiveEmotion(postEmotion)) {
        adjustment *= 1 + boostFactor; // gradual boost (1.0 - 2.0)
        this.logger.debug(
          `Negative streak: boosting positive (streak=${profile.negativeStreak})`,
        );
      }
    }

    // ===== 3. Preferred emotions boost =====
    if (preference?.preferredEmotions?.includes(postEmotion)) {
      adjustment *= 1.3;
    }

    // ===== 4. Healing content mode =====
    if (preference?.allowHealingContent && isPositiveEmotion(postEmotion)) {
      adjustment *= 1.2;
    }

    return adjustment;
  }
}
