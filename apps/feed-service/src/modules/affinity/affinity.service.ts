import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { InteractionType } from '@repo/dtos';
import {
  REDIS_KEYS,
  INTERACTION_WEIGHTS,
  CACHE_TTL_SECONDS,
  VIEW_THRESHOLDS,
  AFFINITY_WEIGHT,
} from './affinity.constants';

type InteractionInput = {
  userId: string;
  category: string;
  authorId: string;
  type: InteractionType | 'view' | 'view_long';
};

type ViewEvent = {
  userId: string;
  category: string;
  authorId: string;
  viewMs: number;
};

interface AffinityResult {
  category: Record<string, number>;
  author: Record<string, number>;
}

@Injectable()
export class AffinityService {
  private readonly logger = new Logger(AffinityService.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  // ------------------------------
  // 🔹 Single interaction
  // ------------------------------
  async updateAffinity(input: InteractionInput): Promise<void> {
    const weight = INTERACTION_WEIGHTS[input.type];
    if (!weight) return;

    const pipeline = this.redis.pipeline();

    pipeline.zincrby(REDIS_KEYS.CATEGORY(input.userId), weight, input.category);

    pipeline.zincrby(REDIS_KEYS.AUTHOR(input.userId), weight, input.authorId);

    pipeline.expire(REDIS_KEYS.CATEGORY(input.userId), CACHE_TTL_SECONDS);
    pipeline.expire(REDIS_KEYS.AUTHOR(input.userId), CACHE_TTL_SECONDS);

    await pipeline.exec();
  }

  // ------------------------------
  // 🔹 Batch view events
  // ------------------------------
  async updateFromViewBatch(events: ViewEvent[]): Promise<void> {
    if (!events.length) return;

    const pipeline = this.redis.pipeline();

    for (const e of events) {
      if (e.viewMs < VIEW_THRESHOLDS.MIN) continue;

      const type = e.viewMs >= VIEW_THRESHOLDS.LONG ? 'view_long' : 'view';

      const weight = INTERACTION_WEIGHTS[type];

      pipeline.zincrby(REDIS_KEYS.CATEGORY(e.userId), weight, e.category);

      pipeline.zincrby(REDIS_KEYS.AUTHOR(e.userId), weight, e.authorId);

      pipeline.expire(REDIS_KEYS.CATEGORY(e.userId), CACHE_TTL_SECONDS);
      pipeline.expire(REDIS_KEYS.AUTHOR(e.userId), CACHE_TTL_SECONDS);
    }

    await pipeline.exec();

    this.logger.debug(`Processed ${events.length} view events`);
  }

  // ------------------------------
  // 🔹 Get affinity
  // ------------------------------
  async getAffinity(userId: string): Promise<AffinityResult> {
    const [catZset, authorZset] = await Promise.all([
      this.redis.zrevrange(REDIS_KEYS.CATEGORY(userId), 0, 20, 'WITHSCORES'),
      this.redis.zrevrange(REDIS_KEYS.AUTHOR(userId), 0, 20, 'WITHSCORES'),
    ]);

    return {
      category: this.normalize(catZset),
      author: this.normalize(authorZset),
    };
  }

  // ------------------------------
  // 🔹 Normalize (FIXED)
  // ------------------------------
  private normalize(zset: string[]): Record<string, number> {
    const result: Record<string, number> = {};

    if (!zset.length) return result;

    let max = 0;

    for (let i = 0; i < zset.length; i += 2) {
      max = Math.max(max, Number(zset[i + 1]));
    }

    if (max === 0) return result;

    for (let i = 0; i < zset.length; i += 2) {
      const key = zset[i];
      const score = Number(zset[i + 1]);

      // 🔥 softmax-lite (giữ relative strength)
      result[key] = score / (score + max);
    }

    return result;
  }

  // ------------------------------
  // 🔹 Calc score (UPGRADED)
  // ------------------------------
  calcAffinityScore(
    affinity: AffinityResult,
    post: { category: string; authorId: string },
  ): number {
    const c = affinity.category[post.category] || 0;
    const a = affinity.author[post.authorId] || 0;

    // ------------------------------
    // 🔥 nonlinear boost
    // ------------------------------
    const categoryScore = Math.pow(c, 0.7);
    const authorScore = Math.pow(a, 0.8);

    // ------------------------------
    // 🔥 smoothing (avoid zero)
    // ------------------------------
    const smoothedCategory = categoryScore || 0.05;
    const smoothedAuthor = authorScore || 0.02;

    const score =
      AFFINITY_WEIGHT.CATEGORY * smoothedCategory +
      AFFINITY_WEIGHT.AUTHOR * smoothedAuthor;

    return Math.min(1, score);
  }
}
