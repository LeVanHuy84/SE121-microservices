import { Injectable, Logger } from '@nestjs/common';
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

  constructor(@InjectRedis() private readonly redis: Redis) {}

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
    emotionLabel: string,
    action: keyof typeof INTERACTION_WEIGHTS,
  ): Promise<void> {
    const weight = INTERACTION_WEIGHTS[action];
    const key = REDIS_KEYS.USER_AFFINITY(userId);

    // 1. Update Redis ZSET
    await this.redis.zincrby(key, weight, emotionLabel);
    await this.redis.expire(key, CACHE_TTL.USER_AFFINITY);

    // 2. Normalize để tổng = 1
    await this.normalizeAffinity(userId);

    this.logger.debug(
      `Updated affinity for user ${userId}: ${emotionLabel} +${weight}`,
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
   * Normalize affinity scores để tổng = 1
   */
  private async normalizeAffinity(userId: string): Promise<void> {
    const key = REDIS_KEYS.USER_AFFINITY(userId);
    const scores = await this.redis.zrange(key, 0, -1, 'WITHSCORES');

    const total = scores
      .filter((_, i) => i % 2 === 1)
      .reduce((sum, score) => sum + parseFloat(score), 0);

    if (total === 0) return;

    const pipeline = this.redis.pipeline();
    for (let i = 0; i < scores.length; i += 2) {
      const emotion = scores[i];
      const score = parseFloat(scores[i + 1]);
      pipeline.zadd(key, score / total, emotion);
    }
    await pipeline.exec();
  }

  /**
   * Cache affinity vào Redis
   */
  private async cacheAffinity(
    userId: string,
    scores: Record<string, number>,
  ): Promise<void> {
    const key = REDIS_KEYS.USER_AFFINITY(userId);
    const pipeline = this.redis.pipeline();

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
}
