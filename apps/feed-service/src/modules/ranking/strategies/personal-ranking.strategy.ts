import { Injectable, Logger } from '@nestjs/common';
import {
  IRankingStrategy,
  RankingCandidate,
  RankingContext,
} from '../interfaces/ranking-strategy.interface';
import { EmotionFeatures } from '../interfaces/emotion-features.interface';
import {
  PERSONAL_DECAY_RATE,
  DIVERSITY_PENALTY_BASE,
  EMOTION_DIVERSITY_WEIGHT,
  EMOTION_DIVERSITY_MIN,
  EMOTION_DIVERSITY_MAX,
  CONFIDENCE_SIGMOID_FACTOR,
  CONFIDENCE_SIGMOID_MIDPOINT,
  RISK_HINT_MULTIPLIERS,
  HIGH_RISK_EXTRA_SUPPRESSION,
  SCENE_AFFINITY_WEIGHT,
  SCENE_AFFINITY_MIN,
  SCENE_AFFINITY_MAX,
} from '../ranking.constants';
import {
  isPositiveEmotion,
  isNegativeEmotion,
} from '../interfaces/emotion-categories.interface';

export interface PostEmotionFeature {
  label: string;
  intensity?: number;
  confidence?: number;
  riskHintLevel?: string;
  dominantScene?: string;
  dominantModality?: string;
  scores?: Record<string, number>;
}

interface EmotionalSafetyStrength {
  positiveBoost: number;
  negativeSuppression: number;
  streakPositiveBoost: number;
  minAdjustment: number;
  maxAdjustment: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeSharedEmotionalSafetyAdjustment(
  postEmotion: string | undefined,
  features: EmotionFeatures | undefined,
  strength: EmotionalSafetyStrength,
  logger?: Logger,
): number {
  if (!postEmotion) return 1.0;

  let adjustment = 1.0;

  if ((features?.riskScore ?? 0) > 0.7) {
    if (isPositiveEmotion(postEmotion)) {
      adjustment *= strength.positiveBoost;
      logger?.debug(
        `High-risk user: boosting positive content (${postEmotion})`,
      );
    } else if (isNegativeEmotion(postEmotion)) {
      adjustment *= strength.negativeSuppression;
      logger?.debug(
        `High-risk user: suppressing negative content (${postEmotion})`,
      );
    }
  } else if (
    (features?.negativeStreak ?? 0) > 3 &&
    isPositiveEmotion(postEmotion)
  ) {
    const streakFactor = Math.min((features?.negativeStreak ?? 0) / 7, 1.0);
    const streakBoost = 1 + streakFactor * (strength.streakPositiveBoost - 1);
    adjustment *= streakBoost;
    logger?.debug(
      `Negative streak: boosting positive (streak=${features?.negativeStreak ?? 0})`,
    );
  }

  return clamp(adjustment, strength.minAdjustment, strength.maxAdjustment);
}

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
  private readonly safetyStrength: EmotionalSafetyStrength = {
    positiveBoost: 2.5,
    negativeSuppression: 0.3,
    streakPositiveBoost: 2.0,
    minAdjustment: 0.3,
    maxAdjustment: 2.5,
  };

  getName(): string {
    return 'personal';
  }

  async computeScore(
    candidate: RankingCandidate,
    context: RankingContext,
  ): Promise<number> {
    const { snapshot, baseScore, timestamp } = candidate;
    const { userAffinity, recentEmotions, emotionFeatures } = context;

    const confidenceWeight = this.computeConfidenceWeight(
      snapshot.emotionFeature?.confidence,
    );

    const affinityMultiplier = this.computeAffinityMultiplier(
      snapshot.emotionFeature,
      userAffinity,
      emotionFeatures?.userEmotionPreference,
      confidenceWeight,
    );

    // Emotional state adjustment (content safety)
    const emotionalStateAdjustment = this.computeEmotionalStateAdjustment(
      snapshot.emotionFeature?.label,
      emotionFeatures,
    );

    const freshnessDecay = this.computeFreshnessDecay(timestamp);

    const diversityPenalty = this.computeDiversityPenalty(
      snapshot.emotionFeature?.label,
      recentEmotions,
    );

    const vectorDiversityFactor = this.computeVectorDiversityFactor(
      snapshot.emotionFeature?.scores,
      userAffinity,
    );

    const riskMultiplier = this.computeRiskHintMultiplier(
      snapshot.emotionFeature?.riskHintLevel,
      emotionFeatures?.riskScore,
    );

    const sceneBoost = this.computeSceneBoost(
      snapshot.emotionFeature?.dominantScene,
      emotionFeatures,
    );

    const engagementBoost = this.computeEngagementBoost(snapshot.stats);

    const finalScore =
      baseScore *
      affinityMultiplier *
      emotionalStateAdjustment *
      freshnessDecay *
      diversityPenalty *
      vectorDiversityFactor *
      riskMultiplier *
      sceneBoost *
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
    emotionFeature?: PostEmotionFeature,
    userAffinity?: Record<string, number>,
    userEmotionPreference?: Record<string, number>,
    confidenceWeight = 1,
  ): number {
    if (!emotionFeature) return 1.0;

    const emotion = emotionFeature.label;
    const affinity = userAffinity?.[emotion] ?? 0.3; // default neutral
    const preference = userEmotionPreference?.[emotion] ?? 0;
    const intensity = emotionFeature.intensity || 0.5;

    // Blend learned affinity with emotion preference features.
    const emotionalRelevance = 0.7 * affinity + 0.3 * preference;
    return clamp(
      1 + emotionalRelevance * intensity * confidenceWeight,
      0.8,
      2.0,
    );
  }

  private computeConfidenceWeight(confidence?: number): number {
    if (confidence === undefined || confidence === null) {
      return 1;
    }

    const normalized = clamp(confidence, 0, 1);
    const x =
      CONFIDENCE_SIGMOID_FACTOR * (normalized - CONFIDENCE_SIGMOID_MIDPOINT);
    return 1 / (1 + Math.exp(-x));
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

  private computeVectorDiversityFactor(
    scores?: Record<string, number>,
    recentEmotionVector?: Record<string, number>,
  ): number {
    if (!scores || Object.keys(scores).length === 0) {
      return 1;
    }

    if (!recentEmotionVector || Object.keys(recentEmotionVector).length === 0) {
      return 1;
    }

    const similarity = this.cosineSimilarity(scores, recentEmotionVector);
    const raw = 1 - EMOTION_DIVERSITY_WEIGHT * similarity;
    return clamp(raw, EMOTION_DIVERSITY_MIN, EMOTION_DIVERSITY_MAX);
  }

  private cosineSimilarity(
    left: Record<string, number>,
    right: Record<string, number>,
  ): number {
    const keys = new Set<string>([...Object.keys(left), ...Object.keys(right)]);

    let dot = 0;
    let leftNormSq = 0;
    let rightNormSq = 0;

    for (const key of keys) {
      const l = Number.isFinite(left[key]) ? Number(left[key]) : 0;
      const r = Number.isFinite(right[key]) ? Number(right[key]) : 0;
      dot += l * r;
      leftNormSq += l * l;
      rightNormSq += r * r;
    }

    const leftNorm = Math.sqrt(leftNormSq);
    const rightNorm = Math.sqrt(rightNormSq);

    if (leftNorm === 0 || rightNorm === 0) {
      return 0;
    }

    return clamp(dot / (leftNorm * rightNorm), 0, 1);
  }

  /**
   * Engagement Boost = 1 + log10(totalEngagement + 1) × 0.1
   */
  private computeEngagementBoost(
    stats: RankingCandidate['snapshot']['stats'],
  ): number {
    const total =
      (stats?.reactions || 0) +
      (stats?.comments || 0) * 2 +
      (stats?.shares || 0) * 3;

    return Math.max(1, 1 + Math.log10(total + 1) * 0.1);
  }

  private computeRiskHintMultiplier(
    riskHintLevel?: string,
    userRiskScore?: number,
  ): number {
    if (!riskHintLevel) return 1;

    const key = riskHintLevel.toLowerCase();
    let multiplier = RISK_HINT_MULTIPLIERS[key] ?? 1;

    if ((userRiskScore ?? 0) > 0.7 && (key === 'high' || key === 'critical')) {
      multiplier *= HIGH_RISK_EXTRA_SUPPRESSION;
    }

    return multiplier;
  }

  private computeSceneBoost(
    dominantScene?: string,
    features?: EmotionFeatures,
  ): number {
    if (!dominantScene) return 1;

    const sceneAffinityMap = (
      features as EmotionFeatures & {
        userSceneAffinity?: Record<string, number>;
      }
    )?.userSceneAffinity;

    if (!sceneAffinityMap) return 1;

    const sceneAffinity = sceneAffinityMap[dominantScene] ?? 0;
    const raw = 1 + SCENE_AFFINITY_WEIGHT * clamp(sceneAffinity, 0, 1);
    return clamp(raw, SCENE_AFFINITY_MIN, SCENE_AFFINITY_MAX);
  }

  /**
   * Emotional State Adjustment - Content Safety Algorithm
   *
   * Prevent negative spiral khi user at-risk:
   * - High risk (>0.7) → boost positive 2.5x, suppress negative 0.3x
   * - Negative streak (>3 days) → gradual boost positive
   * - userEmotionPreference → mild personalization boost
   */
  private computeEmotionalStateAdjustment(
    postEmotion?: string,
    features?: EmotionFeatures,
  ): number {
    let adjustment = computeSharedEmotionalSafetyAdjustment(
      postEmotion,
      features,
      this.safetyStrength,
      this.logger,
    );

    if (!postEmotion) {
      return clamp(
        adjustment,
        this.safetyStrength.minAdjustment,
        this.safetyStrength.maxAdjustment,
      );
    }

    // ===== 3. Mild boost from model-derived user emotion preference =====
    const preference = features?.userEmotionPreference?.[postEmotion] ?? 0;
    if (preference > 0) {
      adjustment *= 1 + Math.min(preference, 1) * 0.2; // max 1.2x
    }

    return clamp(
      adjustment,
      this.safetyStrength.minAdjustment,
      this.safetyStrength.maxAdjustment,
    );
  }
}
