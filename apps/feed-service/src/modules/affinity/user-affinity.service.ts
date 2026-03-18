import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import {
  DEFAULT_USER_AFFINITY,
  REDIS_KEYS,
  CACHE_TTL,
  INTERACTION_WEIGHTS,
} from './affinity.constants';
import {
  normalizeEmotionKey,
  normalizeUserAffinity,
} from 'src/utils/emotion-normalizer';

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
  private readonly localAffinityCache = new Map<
    string,
    Record<string, number>
  >();

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
   * DEFENSIVE: Normalize all emotion keys
   */
  async getUserAffinity(userId: string): Promise<Record<string, number>> {
    const local = this.localAffinityCache.get(userId);
    if (local) {
      return local;
    }

    const key = REDIS_KEYS.USER_AFFINITY(userId);

    const cached = await this.redis.zrange(key, 0, -1, 'WITHSCORES');
    if (cached.length > 0) {
      const parsedAffinity = this.parseZsetToObject(cached);
      // DEFENSIVE: Normalize loaded affinity
      const normalizedAffinity = normalizeUserAffinity(parsedAffinity);
      this.setLocalAffinityCache(userId, normalizedAffinity);
      return normalizedAffinity;
    }

    // User mới → return default (already normalized) and cache
    await this.cacheAffinity(userId, DEFAULT_USER_AFFINITY);
    this.setLocalAffinityCache(userId, DEFAULT_USER_AFFINITY);
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
    this.setLocalAffinityCache(userId, updated);

    await this.cacheAffinity(userId, updated);

    this.logger.debug(
      `Updated affinity for user ${userId} with EMA (alpha=${effectiveAlpha.toFixed(3)}, action=${action})`,
    );
  }

  /**
   * Load scene affinity từ Redis.
   * Return empty object nếu chưa có dữ liệu.
   */
  async getUserSceneAffinity(userId: string): Promise<Record<string, number>> {
    const key = REDIS_KEYS.USER_SCENE_AFFINITY(userId);
    const cached = await this.redis.zrange(key, 0, -1, 'WITHSCORES');

    if (cached.length === 0) {
      return {};
    }

    return this.parseZsetToObject(cached);
  }

  /**
   * Cập nhật scene affinity độc lập với emotion affinity.
   */
  async updateSceneAffinity(
    userId: string,
    scene: string,
    action: keyof typeof INTERACTION_WEIGHTS,
  ): Promise<void> {
    if (!scene) {
      return;
    }

    const weight = INTERACTION_WEIGHTS[action] ?? 0;
    const effectiveAlpha = this.clamp(this.emaAlpha * weight, 0.001, 1);
    const oldAffinity = await this.getUserSceneAffinity(userId);
    const oldValue = this.clamp(oldAffinity[scene] ?? 0, 0, 1);
    const next = (1 - effectiveAlpha) * oldValue + effectiveAlpha;

    const updated = {
      ...oldAffinity,
      [scene]: this.clamp(next, 0, 1),
    };

    await this.cacheSceneAffinity(userId, updated);

    this.logger.debug(
      `Updated scene affinity for user ${userId} (scene=${scene}, alpha=${effectiveAlpha.toFixed(3)}, action=${action})`,
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
   * DEFENSIVE: Normalize emotion label before storing
   */
  async trackViewedEmotion(
    userId: string,
    emotionLabel: string,
  ): Promise<void> {
    const key = REDIS_KEYS.USER_RECENT_EMOTIONS(userId);
    // CRITICAL: Normalize emotional label to lowercase
    const normalizedEmotion = normalizeEmotionKey(emotionLabel);
    if (!normalizedEmotion) return; // Skip invalid emotions

    await this.redis.lpush(key, normalizedEmotion);
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

    for (const [emotion, score] of Object.entries(scores)) {
      pipeline.zadd(key, score, emotion);
    }
    pipeline.expire(key, CACHE_TTL.USER_AFFINITY);
    await pipeline.exec();
  }

  private async cacheSceneAffinity(
    userId: string,
    scores: Record<string, number>,
  ): Promise<void> {
    const key = REDIS_KEYS.USER_SCENE_AFFINITY(userId);
    const pipeline = this.redis.pipeline();

    for (const [scene, score] of Object.entries(scores)) {
      pipeline.zadd(key, this.clamp(score, 0, 1), scene);
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
      // CRITICAL: Normalize emotion string to lowercase
      const normalizedEmotion = normalizeEmotionKey(signalOrEmotion);
      if (!normalizedEmotion) return {};
      return { [normalizedEmotion]: 1 };
    }

    // DEFENSIVE: Normalize all keys in score map
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
    // DEFENSIVE: Normalize all emotion keys to lowercase and filter invalid
    const entries = Object.entries(vector);
    const safeEntries: Array<[string, number]> = [];

    for (const [emotion, value] of entries) {
      const normalizedKey = normalizeEmotionKey(emotion);
      if (normalizedKey) {
        const safeValue = this.clamp(
          Number.isFinite(value) ? Number(value) : 0,
          0,
          1,
        );
        safeEntries.push([normalizedKey, safeValue]);
      }
    }

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

  private setLocalAffinityCache(
    userId: string,
    affinity: Record<string, number>,
  ): void {
    this.localAffinityCache.set(userId, affinity);

    if (this.localAffinityCache.size > 2000) {
      const keys = [...this.localAffinityCache.keys()];
      const evictCount = Math.min(200, keys.length);

      for (let i = 0; i < evictCount; i += 1) {
        const key = keys[Math.floor(Math.random() * keys.length)];
        this.localAffinityCache.delete(key);
      }
    }
  }

  private clamp(value: number, min = 0, max = 1): number {
    return Math.max(min, Math.min(max, value));
  }
}
