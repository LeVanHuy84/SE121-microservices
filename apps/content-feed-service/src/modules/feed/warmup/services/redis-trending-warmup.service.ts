import { InjectRedis } from "@nestjs-modules/ioredis";
import { Injectable, Logger } from "@nestjs/common";
import { Redis } from "ioredis";
import { SnapshotRepository } from "../../mongo/repository/snapshot.repository";

@Injectable()
export class RedisTrendingWarmupService {
  private readonly logger = new Logger(RedisTrendingWarmupService.name);

  private readonly TRENDING_KEY = "post:score";
  private readonly LOCK_KEY = "lock:trending-rebuild";

  private readonly SCORE_TTL_SECONDS = 30 * 24 * 60 * 60;

  private readonly MAX_REBUILD_POSTS = 2000;
  private readonly BATCH_SIZE = 100;
  private readonly DELAY_MS = 100;

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

    const lock = await this.redis.setnx(this.LOCK_KEY, "1");

    if (!lock) {
      this.logger.log("Trending rebuild already running on another instance.");
      return;
    }

    await this.redis.expire(this.LOCK_KEY, 60);

    try {
      const doubleCheckSize = await this.redis.zcard(this.TRENDING_KEY);
      if (doubleCheckSize > 0) {
        this.logger.log(
          `Trending index was rebuilt by another worker (${doubleCheckSize} entries).`,
        );
        return;
      }

      await this.rebuildTrendingIndex();
    } catch (error) {
      this.logger.error("Warmup failed", error);
    } finally {
      await this.redis.del(this.LOCK_KEY);
    }
  }

  private async rebuildTrendingIndex(): Promise<void> {
    let offset = 0;
    let processed = 0;

    this.logger.log("Starting trending warmup (batched)...");

    while (processed < this.MAX_REBUILD_POSTS) {
      const batch = await this.snapshotRepository.findTrendingCandidatesBatch(
        this.BATCH_SIZE,
        offset,
      );

      if (!batch.length) {
        this.logger.log("No more posts to process.");
        break;
      }

      await this.processBatch(batch);

      processed += batch.length;
      offset += batch.length;

      this.logger.log(
        `Warmup progress: ${processed}/${this.MAX_REBUILD_POSTS}`,
      );

      await this.delay(this.DELAY_MS);
    }

    this.logger.log(`✅ Rebuilt trending index: ${processed} posts processed.`);
  }

  private async processBatch(posts: any[]): Promise<void> {
    const pipeline = this.redis.pipeline();

    for (const post of posts) {
      if (!post?.postId) continue;

      const likes = Number(post.stats?.likes ?? 0);
      const comments = Number(post.stats?.comments ?? 0);
      const shares = Number(post.stats?.shares ?? 0);

      const score = Math.max(1, likes + comments * 3 + shares * 4);

      // -----------------------------
      // TRENDING SCORE
      // -----------------------------
      pipeline.zadd(this.TRENDING_KEY, score, post.postId);

      // -----------------------------
      // META
      // -----------------------------
      const metaKey = `post:meta:${post.postId}`;
      const createdAt = post.postCreatedAt
        ? new Date(post.postCreatedAt).getTime()
        : Date.now();

      pipeline.hset(metaKey, {
        createdAt: createdAt.toString(),
        lastStatAt: createdAt.toString(),
      });
      pipeline.expire(metaKey, this.SCORE_TTL_SECONDS);

      // -----------------------------
      // ENGAGEMENT
      // -----------------------------
      const engagementKey = `post:engagement:${post.postId}`;

      pipeline.hset(engagementKey, {
        reactions: Number(post.stats?.reactions ?? 0),
        comments: Number(post.stats?.comments ?? 0),
        shares: Number(post.stats?.shares ?? 0),
      });

      pipeline.expire(engagementKey, this.SCORE_TTL_SECONDS);

      // -----------------------------
      // RANK CACHE
      // -----------------------------
      const rankKey = `post:rank:${post.postId}`;

      pipeline.hset(rankKey, {
        scores: JSON.stringify(post.emotionFeature?.scores || {}),
        intensity: post.emotionFeature?.intensity?.toString() || "0",
        confidence: post.emotionFeature?.confidence?.toString() || "0",
        dominantScene: post.emotionFeature?.dominantScene || "",
        riskHintLevel: post.emotionFeature?.riskHintLevel || "",
        authorId: post.userId,
      });

      pipeline.expire(rankKey, this.SCORE_TTL_SECONDS);

      // -----------------------------
      // EMOTION SCORE (scaled)
      // -----------------------------
      const emotionLabel = post.emotionFeature?.label?.toLowerCase();
      const intensity = Number(post.emotionFeature?.intensity ?? 0);

      if (emotionLabel && intensity > 0) {
        const emotionKey = `post:emotion:${emotionLabel}:score`;

        const emotionScore = intensity * score;

        pipeline.zadd(emotionKey, emotionScore, post.postId);
        pipeline.expire(emotionKey, this.SCORE_TTL_SECONDS);
      }
    }

    await pipeline.exec();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
