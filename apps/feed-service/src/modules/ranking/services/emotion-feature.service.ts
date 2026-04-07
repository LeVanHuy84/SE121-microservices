import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { EmotionRankingFeaturesDto } from '@repo/dtos';

const CACHE_TTL_SECONDS = 900; // 15 min

@Injectable()
export class EmotionFeatureService {
  private readonly logger = new Logger(EmotionFeatureService.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    @Inject('EMOTION_INTELLIGENCE_SERVICE')
    private readonly emotionIntelligenceClient: ClientProxy,
  ) {}

  // =========================
  // 🚀 PUBLIC API
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
  // 🧠 RANKING CORE
  // =========================

  calcEmotionScore(
    features: EmotionRankingFeaturesDto,
    post: {
      scores: Record<string, number>;
      intensity?: number;
      confidence?: number;
      riskHintLevel?: string;
    },
  ): number {
    const pref = this.calcPreferenceMatch(
      features.userEmotionPreference,
      post.scores,
    );

    const moodRaw = this.calcMoodMatch(
      features.last24hEmotionDistribution,
      post.scores,
    );

    const mood = this.applyMoodBoost(moodRaw, post.scores, features);

    const risk = this.calcRiskPenalty(features, post.scores);

    // 🔥 intensity boost
    const intensityBoost = 0.8 + (post.intensity || 0) * 0.4;

    // 🔥 confidence weight
    const confidenceWeight = 0.7 + (post.confidence || 0) * 0.3;

    // 🔥 risk hint
    const riskHintPenalty = post.riskHintLevel === 'HIGH' ? 0.2 : 0;

    let score =
      (0.5 * pref + 0.4 * mood - 0.2 * risk) *
      intensityBoost *
      confidenceWeight;

    score -= riskHintPenalty;

    return this.clamp(score);
  }

  // =========================
  // 📦 CACHE
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
  // 🌐 FETCH
  // =========================

  private async fetchFromAnalysisService(
    userId: string,
  ): Promise<EmotionRankingFeaturesDto | null> {
    try {
      const response = await firstValueFrom(
        this.emotionIntelligenceClient.send('get_emotion_ranking_features', {
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
  // 🧼 NORMALIZATION
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

  private calcPreferenceMatch(
    userPref: Record<string, number>,
    postScores: Record<string, number>,
  ): number {
    let score = 0;

    for (const key in userPref) {
      score += (userPref[key] || 0) * (postScores[key] || 0);
    }

    return score;
  }

  private calcMoodMatch(
    last24h: Record<string, number>,
    postScores: Record<string, number>,
  ): number {
    let score = 0;

    for (const key in last24h) {
      score += (last24h[key] || 0) * (postScores[key] || 0);
    }

    return score;
  }

  private applyMoodBoost(
    moodMatch: number,
    postScores: Record<string, number>,
    features: EmotionRankingFeaturesDto,
  ): number {
    let score = moodMatch;

    const sadness = features.last24hEmotionDistribution.sadness || 0;
    const recent = features.recentNegativityScore || 0;

    const sadnessSignal = 0.7 * sadness + 0.3 * recent;

    if (sadnessSignal > 0.5) {
      const joy = postScores.joy || 0;
      const boost = 1 + sadnessSignal * 0.5;

      score *= joy > 0.3 ? boost : 1 - sadnessSignal * 0.4;
    }

    return score;
  }

  private calcRiskPenalty(
    features: EmotionRankingFeaturesDto,
    postScores: Record<string, number>,
  ): number {
    const negative =
      (postScores.sadness || 0) +
      (postScores.anger || 0) +
      (postScores.fear || 0);

    const baseRisk = features.riskScore;
    const recent = features.recentNegativityScore || 0;
    const momentum = features.emotionMomentum || 0;

    const dynamicRisk =
      baseRisk * 0.6 + recent * 0.3 + Math.max(0, momentum) * 0.1;

    return dynamicRisk * negative;
  }
}
