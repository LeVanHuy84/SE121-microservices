import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectRedis } from "@nestjs-modules/ioredis";
import Redis from "ioredis";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom } from "rxjs";
import { EmotionRankingFeaturesDto, RiskHintLevel } from "@repo/dtos";

const CACHE_TTL_SECONDS = 900; // 15 min

@Injectable()
export class EmotionFeatureService {
  private readonly logger = new Logger(EmotionFeatureService.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    @Inject("EMOTION_INTELLIGENCE_SERVICE")
    private readonly emotionIntelligenceClient: ClientProxy,
  ) {}

  // =========================
  // PUBLIC API
  // =========================

  async getEmotionFeatures(
    userId: string,
  ): Promise<EmotionRankingFeaturesDto | null> {
    try {
      const cached = await this.getCachedFeatures(userId);
      if (cached) return cached;

      const fetched = await this.fetchFromAnalysisService(userId);
      if (!fetched) return null;

      const normalized = this.normalizeFeatures(fetched);

      await this.cacheFeatures(userId, normalized);
      return normalized;
    } catch (error) {
      this.logger.warn(
        `Failed to get emotion features for user ${userId}: ${
          (error as Error).message
        }`,
      );
      return null;
    }
  }

  async invalidateUserCache(userId: string): Promise<void> {
    await this.redis.del(this.getCacheKey(userId));
  }

  // =========================
  // RANKING CORE
  // =========================

  calcEmotionScore(
    features: EmotionRankingFeaturesDto,
    post: {
      scores: Record<string, number>;
      confidence?: number;
      mentalHealthRiskLevel?: string;
    },
  ): number {
    this.logger.log(`User emotion Features: ${JSON.stringify(features)}`);
    this.logger.log(`Post Scores: ${JSON.stringify(post.scores)}`);

    const distress = this.calcDistress(features);

    const novelty = this.calcNoveltyScore(features, post.scores);

    const baseline = this.calcContentBaseline(post.scores);

    const recovery = this.calcRecoveryBoost(features, post.scores);

    const riskPenalty = this.calcRiskPenalty(features, post.scores);

    const confidenceWeight = 0.7 + (post.confidence ?? 0) * 0.3;

    const recoveryWeight = distress > 0.7 ? 0.4 : distress > 0.5 ? 0.25 : 0.1;

    const score =
      (0.55 * novelty +
        0.15 * baseline +
        recoveryWeight * recovery -
        0.25 * riskPenalty) *
      confidenceWeight;

    return this.clamp(score);
  }

  // =========================
  // CACHE
  // =========================

  private getCacheKey(userId: string): string {
    return `cache:emotion:features:${userId}`;
  }

  private async getCachedFeatures(
    userId: string,
  ): Promise<EmotionRankingFeaturesDto | null> {
    const cached = await this.redis.get(this.getCacheKey(userId));
    if (!cached) return null;

    try {
      return this.normalizeFeatures(JSON.parse(cached));
    } catch {
      return null;
    }
  }

  private async cacheFeatures(
    userId: string,
    features: EmotionRankingFeaturesDto,
  ): Promise<void> {
    await this.redis.setex(
      this.getCacheKey(userId),
      CACHE_TTL_SECONDS,
      JSON.stringify(features),
    );
  }

  // =========================
  // FETCH
  // =========================

  private async fetchFromAnalysisService(
    userId: string,
  ): Promise<EmotionRankingFeaturesDto | null> {
    try {
      const response = await firstValueFrom(
        this.emotionIntelligenceClient.send("get_emotion_ranking_features", {
          userId,
        }),
      );

      this.logger.debug(
        `Received response from emotion intelligence service for user ${userId}: ${JSON.stringify(response)}`,
      );

      return response ?? null;
    } catch (error) {
      this.logger.warn(
        `TCP request failed for user ${userId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  // =========================
  // NORMALIZATION
  // =========================

  private normalizeFeatures(
    input: Partial<EmotionRankingFeaturesDto>,
  ): EmotionRankingFeaturesDto {
    return {
      userEmotionPreference: this.normalizeProbabilityMap(
        input.userEmotionPreference,
      ),
      last24hEmotionDistribution: this.normalizeNonNegativeMap(
        input.last24hEmotionDistribution,
      ),
      negativeRatio7d: this.clamp(input.negativeRatio7d ?? 0),
      emotionVolatility7d: this.clamp(input.emotionVolatility7d ?? 0),
      riskScore: this.clamp(input.riskScore ?? 0),

      // (replace negativeStreak)
      recentNegativityScore: this.clamp(input.recentNegativityScore ?? 0),

      // (optional but important)
      emotionMomentum: this.clampSigned(input.emotionMomentum ?? 0),
    };
  }

  private normalizeProbabilityMap(
    map?: Record<string, number>,
  ): Record<string, number> {
    if (!map) return {};

    const normalized: Record<string, number> = {};
    for (const [key, value] of Object.entries(map)) {
      const safeValue = Number.isFinite(value) ? Number(value) : 0;
      normalized[key] = this.clamp(safeValue);
    }
    return normalized;
  }

  private normalizeNonNegativeMap(
    map?: Record<string, number>,
  ): Record<string, number> {
    if (!map) return {};

    const normalized: Record<string, number> = {};
    for (const [key, value] of Object.entries(map)) {
      const safeValue = Number.isFinite(value) ? Number(value) : 0;
      normalized[key] = Math.max(0, safeValue);
    }
    return normalized;
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private clampSigned(value: number): number {
    return Math.max(-1, Math.min(1, value));
  }

  // =========================
  // SCORING LOGIC
  // =========================

  private calcDistress(features: EmotionRankingFeaturesDto): number {
    return this.clamp(
      features.riskScore * 0.4 +
        features.recentNegativityScore * 0.4 +
        features.negativeRatio7d * 0.2,
    );
  }

  private calcContentBaseline(postScores: Record<string, number>): number {
    const joy = postScores.joy || 0;
    const neutral = postScores.neutral || 0;
    const trust = postScores.trust || 0;
    const calm = postScores.calm || 0;

    return this.clamp(joy * 0.2 + neutral * 0.35 + trust * 0.25 + calm * 0.2);
  }

  private calcNoveltyScore(
    features: EmotionRankingFeaturesDto,
    postScores: Record<string, number>,
  ): number {
    let score = 0;

    const exposure = features.last24hEmotionDistribution;

    for (const emotion in postScores) {
      const postEmotion = postScores[emotion] || 0;
      const exposureRate = exposure[emotion] || 0;

      score += postEmotion * (1 - exposureRate);
    }

    return this.clamp(score);
  }

  private calcRecoveryBoost(
    features: EmotionRankingFeaturesDto,
    postScores: Record<string, number>,
  ): number {
    const distress = this.calcDistress(features);

    if (distress < 0.5) {
      return 0;
    }

    const userState = features.userEmotionPreference;

    const sadness = userState.sadness || 0;
    const fear = userState.fear || 0;
    const anger = userState.anger || 0;

    const joy = postScores.joy || 0;
    const trust = postScores.trust || 0;
    const calm = postScores.calm || 0;
    const neutral = postScores.neutral || 0;

    let recovery = 0;

    recovery += sadness * joy;
    recovery += fear * trust;
    recovery += anger * calm;

    recovery += (sadness + fear + anger) * neutral * 0.25;

    return this.clamp(recovery * distress);
  }

  private calcRiskPenalty(
    features: EmotionRankingFeaturesDto,
    postScores: Record<string, number>,
  ): number {
    const distress = this.calcDistress(features);

    const negative =
      (postScores.sadness || 0) * 0.4 +
      (postScores.anger || 0) * 0.3 +
      (postScores.fear || 0) * 0.3;

    return this.clamp(distress * Math.pow(negative, 2));
  }
}
