import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import {
  EmotionProfile,
  EmotionPreference,
  CachedEmotionProfile,
  CachedEmotionPreference,
} from '../interfaces/emotion-profile.interface';

const CACHE_TTL = {
  PROFILE: 3600, // 1 hour
  PREFERENCE: 21600, // 6 hours
};

/**
 * Service quản lý User Emotion Profile & Preference
 * - Fetch từ analysis-service
 * - Cache trong Redis
 * - Fallback gracefully nếu service down
 */
@Injectable()
export class EmotionProfileService {
  private readonly logger = new Logger(EmotionProfileService.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    @Inject('ANALYSIS_SERVICE') private readonly analysisClient: ClientProxy,
  ) {}

  /**
   * Load user emotion profile (baseline, risk score)
   */
  async getUserProfile(userId: string): Promise<EmotionProfile | null> {
    try {
      // 1. Try cache first
      const cached = await this.getCachedProfile(userId);
      if (cached) return cached;

      // 2. Fetch from analysis-service
      const profile = await firstValueFrom(
        this.analysisClient
          .send<any>('get_user_emotion_profile', { userId })
          .pipe(timeout(3000)), // 3s timeout
      );

      if (!profile) return null;

      // 3. Transform & cache
      const transformed = this.transformProfile(profile);
      await this.cacheProfile(userId, transformed);

      return transformed;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch emotion profile for user ${userId}:`,
        error.message,
      );
      return null; // graceful fallback
    }
  }

  /**
   * Load user emotion preference (explicit settings)
   */
  async getUserPreference(userId: string): Promise<EmotionPreference | null> {
    try {
      // 1. Try cache first
      const cached = await this.getCachedPreference(userId);
      if (cached) return cached;

      // 2. Fetch from analysis-service
      const preference = await firstValueFrom(
        this.analysisClient
          .send<any>('get_user_emotion_preference', { userId })
          .pipe(timeout(3000)),
      );

      if (!preference) return null;

      // 3. Transform & cache
      const transformed = this.transformPreference(preference);
      await this.cachePreference(userId, transformed);

      return transformed;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch emotion preference for user ${userId}:`,
        error.message,
      );
      return null;
    }
  }

  /**
   * Invalidate cache (gọi khi analysis-service update)
   */
  async invalidateUserCache(userId: string): Promise<void> {
    await Promise.all([
      this.redis.del(`cache:emotion:profile:${userId}`),
      this.redis.del(`cache:emotion:preference:${userId}`),
    ]);
  }

  // ========= Private helpers =========

  private async getCachedProfile(
    userId: string,
  ): Promise<EmotionProfile | null> {
    const key = `cache:emotion:profile:${userId}`;
    const cached = await this.redis.get(key);

    if (!cached) return null;

    try {
      const parsed: CachedEmotionProfile = JSON.parse(cached);
      return {
        ...parsed,
        updatedAt: new Date(parsed.updatedAt),
        lastNegativeAt: parsed.lastNegativeAt
          ? new Date(parsed.lastNegativeAt)
          : undefined,
      };
    } catch {
      return null;
    }
  }

  private async getCachedPreference(
    userId: string,
  ): Promise<EmotionPreference | null> {
    const key = `cache:emotion:preference:${userId}`;
    const cached = await this.redis.get(key);

    if (!cached) return null;

    try {
      const parsed: CachedEmotionPreference = JSON.parse(cached);
      return {
        ...parsed,
        updatedAt: new Date(parsed.updatedAt),
      };
    } catch {
      return null;
    }
  }

  private async cacheProfile(
    userId: string,
    profile: EmotionProfile,
  ): Promise<void> {
    const key = `cache:emotion:profile:${userId}`;
    const toCache: CachedEmotionProfile = {
      ...profile,
      updatedAt: profile.updatedAt.toISOString(),
      lastNegativeAt: profile.lastNegativeAt?.toISOString(),
    };

    await this.redis.setex(key, CACHE_TTL.PROFILE, JSON.stringify(toCache));
  }

  private async cachePreference(
    userId: string,
    preference: EmotionPreference,
  ): Promise<void> {
    const key = `cache:emotion:preference:${userId}`;
    const toCache: CachedEmotionPreference = {
      ...preference,
      updatedAt: preference.updatedAt.toISOString(),
    };

    await this.redis.setex(key, CACHE_TTL.PREFERENCE, JSON.stringify(toCache));
  }

  /**
   * Transform từ Python schema sang TypeScript
   */
  private transformProfile(data: any): EmotionProfile {
    return {
      userId: data.userId,
      baselineEmotion: data.dominantBaselineEmotion,
      baselineVector: data.emotionVectorEMA || {},
      negativeStreak: data.negativeStreakDays || 0,
      lastNegativeAt: data.lastNegativeAt
        ? new Date(data.lastNegativeAt)
        : undefined,
      riskScore: this.calculateRiskScore(data),
      totalAnalyses: data.totalAnalyses || 0,
      updatedAt: new Date(data.updatedAt || Date.now()),
    };
  }

  private transformPreference(data: any): EmotionPreference {
    return {
      userId: data.userId,
      preferredEmotions: data.preferredEmotions || [],
      avoidedEmotions: data.avoidEmotions || [],
      allowHealingContent: data.allowHealingContent ?? true,
      allowMentalAlert: data.allowMentalAlert ?? true,
      updatedAt: new Date(data.updatedAt || Date.now()),
    };
  }

  /**
   * Calculate risk score từ negative streak & baseline
   */
  private calculateRiskScore(data: any): number {
    const negativeStreak = data.negativeStreakDays || 0;
    const baselineEmotion = data.dominantBaselineEmotion || 'neutral';

    let score = 0;

    // 1. Negative streak contribution (0-0.6)
    if (negativeStreak > 0) {
      score += Math.min(negativeStreak / 14, 0.6); // max at 14 days
    }

    // 2. Baseline emotion contribution (0-0.4)
    if (['sadness', 'anger', 'fear'].includes(baselineEmotion)) {
      score += 0.4;
    } else if (baselineEmotion === 'neutral') {
      score += 0.2;
    }

    return Math.min(score, 1.0);
  }
}
