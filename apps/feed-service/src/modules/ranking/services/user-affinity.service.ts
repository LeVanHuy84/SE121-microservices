import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import {
  DEFAULT_USER_AFFINITY,
  REDIS_KEYS,
  CACHE_TTL,
  INTERACTION_WEIGHTS,
} from '../ranking.constants';

/**
 * Service quản lý User Emotion Affinity
 * - Load/cache user affinity scores
 * - Update affinity khi user interact
 * - Track recent viewed emotions
 */
@Injectable()
export class UserAffinityService {
  private readonly logger = new Logger(UserAffinityService.name);
  private readonly emaAlpha: number;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    const configuredAlpha = this.configService.get<number>(
      'AFFINITY_EMA_ALPHA',
      0.2,
    );
    this.emaAlpha = this.clamp(configuredAlpha, 0.01, 1);
  }

  /**
   * Load user affinity từ Redis
   * Fallback to default nếu user mới
   */
  async getUserAffinity(userId: string): Promise<Record<string, number>> {
    const key = REDIS_KEYS.USER_AFFINITY(userId);

    const cached = await this.redis.zrange(key, 0, -1, 'WITHSCORES');
    if (cached.length > 0) {
      return this.parseZsetToObject(cached);
    }

    // User mới → return default và cache
    await this.cacheAffinity(userId, DEFAULT_USER_AFFINITY);
    return DEFAULT_USER_AFFINITY;
  }

  /**
   * Cập nhật affinity khi user interact với post
   */
  async updateAffinity(
    userId: string,
    signalOrEmotion: Record<string, number> | string,
    action: keyof typeof INTERACTION_WEIGHTS,
  ): Promise<void> {
    const weight = INTERACTION_WEIGHTS[action] ?? 0;
    const oldAffinity = await this.getUserAffinity(userId);
    const signal = this.buildSignalVector(signalOrEmotion);

    if (Object.keys(signal).length === 0) {
      return;
    }

    const effectiveAlpha = this.clamp(this.emaAlpha * weight, 0.001, 1);
    const updated = this.applyEmaUpdate(oldAffinity, signal, effectiveAlpha);

    await this.cacheAffinity(userId, updated);

    this.logger.debug(
      `Updated affinity for user ${userId} with EMA (alpha=${effectiveAlpha.toFixed(3)}, action=${action})`,
    );
  }

  /**
   * Lấy 20 emotions gần nhất user đã xem (cho diversity penalty)
   */
  async getRecentEmotions(userId: string, limit = 20): Promise<string[]> {
    const key = REDIS_KEYS.USER_RECENT_EMOTIONS(userId);
    return this.redis.lrange(key, 0, limit - 1);
  }

  /**
   * Track emotion khi user view post
   */
  async trackViewedEmotion(
    userId: string,
    emotionLabel: string,
  ): Promise<void> {
    const key = REDIS_KEYS.USER_RECENT_EMOTIONS(userId);
    await this.redis.lpush(key, emotionLabel);
    await this.redis.ltrim(key, 0, 49); // giữ 50 gần nhất
    await this.redis.expire(key, CACHE_TTL.RECENT_EMOTIONS);
  }

  // ========= Private helpers =========

  /**
   * Cache affinity vào Redis
   */
  private async cacheAffinity(
    userId: string,
    scores: Record<string, number>,
  ): Promise<void> {
    const key = REDIS_KEYS.USER_AFFINITY(userId);
    const pipeline = this.redis.pipeline();

    pipeline.del(key);

    for (const [emotion, score] of Object.entries(scores)) {
      pipeline.zadd(key, score, emotion);
    }
    pipeline.expire(key, CACHE_TTL.USER_AFFINITY);
    await pipeline.exec();
  }

  /**
   * Parse Redis ZSET result sang object
   */
  private parseZsetToObject(zset: string[]): Record<string, number> {
    const obj: Record<string, number> = {};
    for (let i = 0; i < zset.length; i += 2) {
      obj[zset[i]] = parseFloat(zset[i + 1]);
    }
    return obj;
  }

  private buildSignalVector(
    signalOrEmotion: Record<string, number> | string,
  ): Record<string, number> {
    if (typeof signalOrEmotion === 'string') {
      return { [signalOrEmotion]: 1 };
    }

    return this.normalizeVector(signalOrEmotion);
  }

  private applyEmaUpdate(
    oldAffinity: Record<string, number>,
    signal: Record<string, number>,
    alpha: number,
  ): Record<string, number> {
    const emotions = new Set<string>([
      ...Object.keys(DEFAULT_USER_AFFINITY),
      ...Object.keys(oldAffinity),
      ...Object.keys(signal),
    ]);

    const updated: Record<string, number> = {};
    for (const emotion of emotions) {
      const oldValue = this.clamp(oldAffinity[emotion] ?? 0, 0, 1);
      const signalValue = this.clamp(signal[emotion] ?? 0, 0, 1);
      const next = (1 - alpha) * oldValue + alpha * signalValue;
      updated[emotion] = this.clamp(next, 0, 1);
    }

    return this.normalizeVector(updated);
  }

  private normalizeVector(
    vector: Record<string, number>,
  ): Record<string, number> {
    const safeEntries = Object.entries(vector).map(([emotion, value]) => [
      emotion,
      this.clamp(Number.isFinite(value) ? Number(value) : 0, 0, 1),
    ]) as Array<[string, number]>;

    const total = safeEntries.reduce((sum, [, value]) => sum + value, 0);

    if (total <= 0) {
      return { ...DEFAULT_USER_AFFINITY };
    }

    const normalized: Record<string, number> = {};
    for (const [emotion, value] of safeEntries) {
      normalized[emotion] = value / total;
    }

    return normalized;
  }

  private clamp(value: number, min = 0, max = 1): number {
    return Math.max(min, Math.min(max, value));
  }
}
