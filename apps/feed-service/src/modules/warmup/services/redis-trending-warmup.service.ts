import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { SnapshotRepository } from 'src/mongo/repository/snapshot.repository';

@Injectable()
export class RedisTrendingWarmupService {
  private readonly logger = new Logger(RedisTrendingWarmupService.name);

  private readonly TRENDING_KEY = 'post:score';
  private readonly LOCK_KEY = 'lock:trending-rebuild';
  private readonly SCORE_TTL_SECONDS = 30 * 24 * 60 * 60;
  private readonly MAX_REBUILD_POSTS = 1000;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly snapshotRepository: SnapshotRepository,
  ) {}

  async ensureTrendingIndex(): Promise<void> {
    const currentSize = await this.redis.zcard(this.TRENDING_KEY);

    if (currentSize > 0) {
      this.logger.log(
        `Trending index already exists (${currentSize} entries). Skipping warmup.`,
      );
      return;
    }

    const lock = await this.redis.setnx(this.LOCK_KEY, '1');

    if (!lock) {
      this.logger.log('Trending rebuild already running on another instance.');
      return;
    }

    await this.redis.expire(this.LOCK_KEY, 10);

    const doubleCheckSize = await this.redis.zcard(this.TRENDING_KEY);
    if (doubleCheckSize > 0) {
      this.logger.log(
        `Trending index was rebuilt by another worker (${doubleCheckSize} entries).`,
      );
      return;
    }

    await this.rebuildTrendingIndex();
  }

  private async rebuildTrendingIndex(): Promise<void> {
    const candidates = await this.snapshotRepository.findTrendingCandidates(
      this.MAX_REBUILD_POSTS,
    );

    if (!candidates.length) {
      this.logger.warn('No trending candidates found in MongoDB for rebuild.');
      return;
    }

    const pipeline = this.redis.pipeline();

    for (const post of candidates) {
      if (!post.postId) continue;
      const likes = Number(post.stats?.likes ?? 0);
      const comments = Number(post.stats?.comments ?? 0);
      const shares = Number(post.stats?.shares ?? 0);
      const score = Math.max(1, likes + comments * 3 + shares * 4);

      pipeline.zadd(this.TRENDING_KEY, score, post.postId);

      const metaKey = `post:meta:${post.postId}`;
      const createdAt = post.postCreatedAt
        ? new Date(post.postCreatedAt).getTime()
        : Date.now();

      pipeline.hset(metaKey, {
        createdAt: createdAt.toString(),
        lastStatAt: createdAt.toString(),
      });
      pipeline.expire(metaKey, this.SCORE_TTL_SECONDS);

      const emotionLabel = post.emotionFeature?.label?.toLowerCase();
      const intensity = Number(post.emotionFeature?.intensity ?? 0);

      if (emotionLabel && intensity > 0) {
        const emotionKey = `post:emotion:${emotionLabel}:score`;
        pipeline.zadd(emotionKey, intensity, post.postId);
        pipeline.expire(emotionKey, this.SCORE_TTL_SECONDS);
      }
    }

    await pipeline.exec();

    this.logger.log(
      `Rebuilt trending index from MongoDB: ${candidates.length} posts restored.`,
    );
  }
}
