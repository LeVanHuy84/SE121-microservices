import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import {
  EmotionFeatures,
  EmotionFeaturesResponse,
} from '../interfaces/emotion-features.interface';

const CACHE_TTL_SECONDS = 3600; // 1 hour

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
}
