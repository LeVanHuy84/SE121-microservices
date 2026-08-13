import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import * as crypto from 'crypto';

@Injectable()
export class QueryCacheService {
  private readonly logger = new Logger(QueryCacheService.name);
  private readonly keyPrefix: string;
  private readonly ttlMs: number;
  private readonly sessionTtlMs: number;
  private readonly maxEntries: number;

  constructor(@InjectRedis() private readonly redis: Redis) {
    this.keyPrefix =
      process.env.RECOMMENDATION_QUERY_CACHE_REDIS_PREFIX ||
      'recommendation:query-cache';
    this.ttlMs =
      (Number(process.env.RECOMMENDATION_QUERY_CACHE_TTL_SECONDS) || 30) * 1000;
    this.sessionTtlMs =
      (Number(process.env.RECOMMENDATION_QUERY_SESSION_TTL_SECONDS) || 120) *
      1000;
    this.maxEntries =
      Number(process.env.RECOMMENDATION_QUERY_CACHE_MAX_ENTRIES) || 1000;
  }

  private makeEntryKey(request: any): string {
    const payload = {
      viewerId: String(request.viewerId || '').trim(),
      limit: Number(request.limit) || 20,
      cursor: String(request.cursor || ''),
      viewerProfileText: String(request.viewerProfileText || '').trim(),
    };
    const serialized = JSON.stringify(payload);
    const hash = crypto.createHash('sha256').update(serialized).digest('hex');
    return `${this.keyPrefix}:entry:${hash}`;
  }

  private makeViewerKey(viewerId: string): string {
    const hash = crypto.createHash('sha256').update(viewerId).digest('hex');
    return `${this.keyPrefix}:viewer:${hash}`;
  }

  private makeSessionKey(sessionId: string): string {
    return `${this.keyPrefix}:session:${sessionId}`;
  }

  private get indexKey(): string {
    return `${this.keyPrefix}:index`;
  }

  private get statsKey(): string {
    return `${this.keyPrefix}:stats`;
  }

  async get(request: any): Promise<any | null> {
    try {
      if (this.ttlMs <= 0) return null;
      const cacheKey = this.makeEntryKey(request);
      const payload = await this.redis.get(cacheKey);
      if (!payload) {
        await this.redis.hincrby(this.statsKey, 'misses', 1);
        await this.redis.zrem(this.indexKey, cacheKey);
        return null;
      }
      await this.redis.zadd(this.indexKey, Date.now(), cacheKey);
      await this.redis.hincrby(this.statsKey, 'hits', 1);
      return JSON.parse(payload);
    } catch (err) {
      this.logger.warn(`Redis query cache get failed: ${err.message}`);
      return null;
    }
  }

  async set(request: any, output: any): Promise<any> {
    try {
      if (this.ttlMs <= 0) return output;
      const cacheKey = this.makeEntryKey(request);
      const viewerKey = this.makeViewerKey(
        String(request.viewerId || '').trim(),
      );
      const payload = JSON.stringify(output);

      const pipeline = this.redis.pipeline();
      pipeline.set(cacheKey, payload, 'PX', this.ttlMs);
      pipeline.sadd(viewerKey, cacheKey);
      pipeline.pexpire(viewerKey, this.ttlMs);
      pipeline.zadd(this.indexKey, Date.now(), cacheKey);
      pipeline.hincrby(this.statsKey, 'sets', 1);
      await pipeline.exec();

      await this.evictOverLimit();
    } catch (err) {
      this.logger.warn(`Redis query cache set failed: ${err.message}`);
    }
    return output;
  }

  async invalidateViewer(viewerId: string): Promise<void> {
    const normalized = String(viewerId || '').trim();
    if (!normalized) return;
    try {
      const viewerKey = this.makeViewerKey(normalized);
      const keys = await this.redis.smembers(viewerKey);
      if (keys.length === 0) return;

      const pipeline = this.redis.pipeline();
      for (const key of keys) {
        pipeline.del(key);
        pipeline.zrem(this.indexKey, key);
      }
      pipeline.del(viewerKey);
      pipeline.hincrby(this.statsKey, 'invalidations', 1);
      await pipeline.exec();
    } catch (err) {
      this.logger.warn(`Redis query cache invalidation failed: ${err.message}`);
    }
  }

  async invalidateMany(viewerIds: string[]): Promise<void> {
    await Promise.all(viewerIds.map((id) => this.invalidateViewer(id)));
  }

  async storeCandidateSession(
    viewerId: string,
    source: string,
    scoreVersion: string,
    candidates: any[],
  ): Promise<string | null> {
    const normalized = String(viewerId || '').trim();
    if (!normalized || candidates.length === 0) return null;

    try {
      const sessionId = crypto.randomUUID().replace(/-/g, '');
      const sessionKey = this.makeSessionKey(sessionId);
      const viewerKey = this.makeViewerKey(normalized);
      const payload = {
        viewerId: normalized,
        source: source || 'semantic_online',
        scoreVersion,
        candidates,
      };

      const pipeline = this.redis.pipeline();
      pipeline.set(
        sessionKey,
        JSON.stringify(payload),
        'PX',
        this.sessionTtlMs,
      );
      pipeline.sadd(viewerKey, sessionKey);
      pipeline.pexpire(viewerKey, Math.max(this.ttlMs, this.sessionTtlMs));
      pipeline.hincrby(this.statsKey, 'sessions', 1);
      await pipeline.exec();

      return sessionId;
    } catch (err) {
      this.logger.warn(`Redis query session set failed: ${err.message}`);
      return null;
    }
  }

  async getCandidateSession(sessionId: string): Promise<any | null> {
    const cleanId = String(sessionId || '').trim();
    if (!cleanId) return null;
    try {
      const payload = await this.redis.get(this.makeSessionKey(cleanId));
      if (!payload) {
        await this.redis.hincrby(this.statsKey, 'sessionMisses', 1);
        return null;
      }
      await this.redis.hincrby(this.statsKey, 'sessionHits', 1);
      return JSON.parse(payload);
    } catch (err) {
      this.logger.warn(`Redis query session get failed: ${err.message}`);
      return null;
    }
  }

  private async evictOverLimit(): Promise<void> {
    try {
      const count = await this.redis.zcard(this.indexKey);
      const overflow = count - this.maxEntries;
      if (overflow <= 0) return;

      const keys = await this.redis.zrange(this.indexKey, 0, overflow - 1);
      if (keys.length === 0) return;

      const pipeline = this.redis.pipeline();
      for (const key of keys) {
        pipeline.del(key);
        pipeline.zrem(this.indexKey, key);
      }
      pipeline.hincrby(this.statsKey, 'evictions', keys.length);
      await pipeline.exec();
    } catch (err) {
      this.logger.warn(`Redis query cache eviction failed: ${err.message}`);
    }
  }
}
