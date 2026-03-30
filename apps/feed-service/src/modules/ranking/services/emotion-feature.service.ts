import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import {
  EmotionFeatures,
  EmotionFeaturesResponse,
} from '../interfaces/emotion-features.interface';

const CACHE_TTL_SECONDS = 900; // 15 minute

@Injectable()
export class EmotionFeatureService {
  private readonly logger = new Logger(EmotionFeatureService.name);
  private readonly baseUrl: string;
  private readonly internalKey?: string;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    const baseUrl = this.configService.get<string>('ANALYSIS_SERVICE_URL');

    if (!baseUrl) {
      throw new Error('ANALYSIS_SERVICE_URL is not configured');
    }

    this.baseUrl = baseUrl.replace(/\/$/, '');

    this.internalKey = this.configService.get<string>('ANALYSIS_INTERNAL_KEY');
  }

  async getEmotionFeatures(userId: string): Promise<EmotionFeatures | null> {
    try {
      const cached = await this.getCachedFeatures(userId);
      if (cached) {
        return cached;
      }

      const fetched = await this.fetchFromAnalysisService(userId);
      if (!fetched) {
        return null;
      }

      const normalized = this.normalizeFeatures(fetched);
      await this.cacheFeatures(userId, normalized);
      return normalized;
    } catch (error) {
      this.logger.warn(
        `Failed to get emotion features for user ${userId}: ${error.message}`,
      );
      return null;
    }
  }

  async invalidateUserCache(userId: string): Promise<void> {
    await this.redis.del(this.getCacheKey(userId));
  }

  calcEmotionScore(
    features: EmotionFeatures,
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

    const risk = this.calcRiskPenalty(features.riskScore, post.scores);

    // ------------------------------
    // 🔥 NEW: intensity boost
    // ------------------------------
    const intensityBoost = 0.8 + (post.intensity || 0) * 0.4;
    // range: 0.8 → 1.2

    // ------------------------------
    // 🔥 NEW: confidence weight
    // ------------------------------
    const confidenceWeight = 0.7 + (post.confidence || 0) * 0.3;
    // range: 0.7 → 1

    // ------------------------------
    // 🔥 NEW: risk hint penalty
    // ------------------------------
    const riskHintPenalty = post.riskHintLevel === 'HIGH' ? 0.2 : 0;

    let score =
      (0.5 * pref + 0.4 * mood - 0.2 * risk) *
      intensityBoost *
      confidenceWeight;

    score -= riskHintPenalty;

    return Math.max(0, Math.min(1, score));
  }

  private getCacheKey(userId: string): string {
    return `cache:emotion:features:${userId}`;
  }

  private async getCachedFeatures(
    userId: string,
  ): Promise<EmotionFeatures | null> {
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
    features: EmotionFeatures,
  ): Promise<void> {
    await this.redis.setex(
      this.getCacheKey(userId),
      CACHE_TTL_SECONDS,
      JSON.stringify(features),
    );
  }

  private async fetchFromAnalysisService(
    userId: string,
  ): Promise<EmotionFeatures | null> {
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };

      if (this.internalKey) {
        headers['x-internal-key'] = this.internalKey;
      }

      const response = await fetch(
        `${this.baseUrl}/emotion/features/${userId}`,
        {
          method: 'GET',
          headers,
        },
      );

      if (!response.ok) {
        this.logger.warn(
          `Analysis-service request failed (${response.status}) for user ${userId}`,
        );
        return null;
      }

      const payload = (await response.json()) as EmotionFeaturesResponse;
      return payload?.features ?? null;
    } catch (error) {
      this.logger.warn(
        `Failed request for user ${userId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private normalizeFeatures(input: Partial<EmotionFeatures>): EmotionFeatures {
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
      negativeStreak: Math.max(0, Math.floor(input.negativeStreak ?? 0)),
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

  private calcPreferenceMatch(
    userPref: Record<string, number>,
    postScores: Record<string, number>,
  ): number {
    let score = 0;

    for (const key in userPref) {
      score += (userPref[key] || 0) * (postScores[key] || 0);
    }

    return score; // ~0 → 1
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
    features: EmotionFeatures,
  ): number {
    let score = moodMatch;

    const sadness = features.last24hEmotionDistribution.sadness || 0;

    // user đang buồn → ưu tiên joy
    if (sadness > 0.6) {
      const joy = postScores.joy || 0;

      if (joy > 0.3) {
        score *= 1.3;
      } else {
        score *= 0.8;
      }
    }

    return score;
  }

  private calcRiskPenalty(
    riskScore: number,
    postScores: Record<string, number>,
  ): number {
    const negative =
      (postScores.sadness || 0) +
      (postScores.anger || 0) +
      (postScores.fear || 0);

    return riskScore * negative; // 0 → 1
  }
}
