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
import {
  CONFIDENCE_SIGMOID_FACTOR,
  CONFIDENCE_SIGMOID_MIDPOINT,
  RISK_HINT_MULTIPLIERS,
  HIGH_RISK_EXTRA_SUPPRESSION,
  MODALITY_WEIGHTS,
  EMOTION_DIVERSITY_WEIGHT,
  EMOTION_DIVERSITY_MIN,
  EMOTION_DIVERSITY_MAX,
  SCENE_AFFINITY_WEIGHT,
  SCENE_AFFINITY_MIN,
  SCENE_AFFINITY_MAX,
} from '../ranking.constants';

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
  async rankForTrending<T extends RankingCandidate>(
    candidates: T[],
    userId: string,
  ): Promise<Array<T & Pick<RankedItem, 'finalScore'>>> {
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

    this.logger.debug(
      `Ranking ${candidates.length} candidates for user ${userId} with context: ` +
        `affinity=${JSON.stringify(userAffinity)}, ` +
        `recentEmotions=${JSON.stringify(recentEmotions)}, ` +
        `emotionFeatures=${JSON.stringify(emotionFeatures)}`,
    );

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
  async rankForPersonal<T extends RankingCandidate>(
    candidates: T[],
    userId: string,
  ): Promise<Array<T & Pick<RankedItem, 'finalScore' | 'featureScores'>>> {
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
    const { userAffinity, recentEmotions, emotionFeatures } = context;

    // Affinity score
    const emotion = snapshot.emotionFeature?.label;
    const affinity =
      emotion && userAffinity ? userAffinity[emotion] || 0.3 : 0.3;
    const intensity = snapshot.emotionFeature?.intensity || 0.5;
    const affinityScore = 1 + affinity * intensity;

    const confidenceWeight = this.computeConfidenceWeight(
      snapshot.emotionFeature?.confidence,
    );

    // Freshness score
    const hours = (Date.now() - timestamp.getTime()) / 3600000;
    const freshnessScore = Math.exp(-0.05 * hours);

    // Diversity penalty (label-level + vector-level)
    const count =
      emotion && recentEmotions
        ? recentEmotions.filter((e) => e === emotion).length
        : 0;
    const labelDiversityPenalty = Math.pow(0.95, count);
    const vectorDiversityPenalty = this.computeVectorDiversityFactor(
      snapshot.emotionFeature?.scores,
      userAffinity,
    );
    const diversityPenalty = labelDiversityPenalty * vectorDiversityPenalty;

    const riskMultiplier = this.computeRiskHintMultiplier(
      snapshot.emotionFeature?.riskHintLevel,
      emotionFeatures?.riskScore,
    );

    const modalityWeight = this.computeModalityWeight(
      snapshot.emotionFeature?.dominantModality,
    );

    const sceneBoost = this.computeSceneBoost(
      snapshot.emotionFeature?.dominantScene,
      emotionFeatures,
    );

    return {
      affinity: affinityScore,
      freshness: freshnessScore,
      diversity: diversityPenalty,
      diversityPenalty,
      confidenceWeight,
      riskMultiplier,
      modalityWeight,
      sceneBoost,
    };
  }

  private computeConfidenceWeight(confidence?: number): number {
    if (confidence === undefined || confidence === null) {
      return 1;
    }

    const normalized = this.clamp(confidence, 0, 1);
    const x =
      CONFIDENCE_SIGMOID_FACTOR * (normalized - CONFIDENCE_SIGMOID_MIDPOINT);
    return 1 / (1 + Math.exp(-x));
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
    return this.clamp(raw, EMOTION_DIVERSITY_MIN, EMOTION_DIVERSITY_MAX);
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

    return this.clamp(dot / (leftNorm * rightNorm), 0, 1);
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

  private computeModalityWeight(dominantModality?: string): number {
    if (!dominantModality) return 1;
    return MODALITY_WEIGHTS[dominantModality.toLowerCase()] ?? 1;
  }

  private computeSceneBoost(
    dominantScene?: string,
    features?: RankingContext['emotionFeatures'],
  ): number {
    if (!dominantScene) return 1;

    const sceneAffinityMap = (
      features as RankingContext['emotionFeatures'] & {
        userSceneAffinity?: Record<string, number>;
      }
    )?.userSceneAffinity;

    if (!sceneAffinityMap) return 1;

    const sceneAffinity = this.clamp(
      sceneAffinityMap[dominantScene] ?? 0,
      0,
      1,
    );
    const raw = 1 + SCENE_AFFINITY_WEIGHT * sceneAffinity;
    return this.clamp(raw, SCENE_AFFINITY_MIN, SCENE_AFFINITY_MAX);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
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
