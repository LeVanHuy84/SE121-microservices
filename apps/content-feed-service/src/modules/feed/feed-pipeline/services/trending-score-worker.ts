import { InjectRedis } from "@nestjs-modules/ioredis";
import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Redis } from "ioredis";

type RedisHash = Record<string, string>;

@Injectable()
export class TrendingWorker {
  private readonly logger = new Logger(TrendingWorker.name);

  // tuning
  private readonly DIRTY_BATCH = 200;
  private readonly FRESH_BATCH = 100;
  private readonly TOP_BATCH = 50;

  constructor(@InjectRedis() private readonly redis: Redis) {}

  // ================================
  // 🧠 CORE LOGIC
  // ================================
  private async recomputeScores(
    postIds: string[],
    type?: "dirty" | "fresh" | "top",
  ) {
    if (!postIds.length) return;

    const unique = [...new Set(postIds)];

    const pipeline = this.redis.pipeline();

    for (const postId of unique) {
      pipeline.hgetall(`post:meta:${postId}`);
      pipeline.hgetall(`post:engagement:${postId}`);
    }

    const results = await pipeline.exec();
    if (!results) return;

    const updates = this.redis.pipeline();
    const now = Date.now();

    for (let i = 0; i < unique.length; i++) {
      const postId = unique[i];

      const meta = results[i * 2]?.[1] as RedisHash;
      const engagement = results[i * 2 + 1]?.[1] as RedisHash;

      if (!meta?.createdAt) continue;

      // ------------------------------
      // 📊 Engagement
      // ------------------------------
      const reactions = Number(engagement?.reactions || 0);
      const comments = Number(engagement?.comments || 0);
      const shares = Number(engagement?.shares || 0);

      const weighted = reactions + comments * 2 + shares * 5 + 1;

      // ------------------------------
      // ⏳ Time decay & freshness Boost
      // ------------------------------
      const raw = Math.log1p(weighted);

      const nowBucket = Math.floor(Date.now() / (60 * 1000)) * (60 * 1000); // làm tròn xuống phút gần nhất để tránh score nhảy liên tục mỗi giây

      const ageHours = (nowBucket - Number(meta.createdAt)) / (1000 * 60 * 60);

      const timeDecay = Math.exp(-ageHours / 48);
      const freshnessBoost = Math.exp(-ageHours / 12);

      let score = raw * timeDecay * (1 + 0.2 * freshnessBoost);

      // ------------------------------
      // 🪶 Tie-break nhẹ
      // ------------------------------
      const createdAt = Number(meta.createdAt);
      score = this.addTieBreak(score, createdAt);

      // ------------------------------
      // 🧱 Update main score
      // ------------------------------
      updates.zadd("post:score", score, postId);

      // ------------------------------
      // 🎭 Emotion ranking
      // ------------------------------
      const rank = await this.redis.hgetall(`post:rank:${postId}`);
      const emotionLabel = rank?.label;

      if (emotionLabel) {
        updates.zadd(`post:emotion:${emotionLabel}:score`, score, postId);
        updates.expire(`post:emotion:${emotionLabel}:score`, 30 * 24 * 60 * 60);
      }
    }

    await updates.exec();

    this.logger.log(
      `${type?.toUpperCase()}: Recomputed ${unique.length} posts`,
    );
  }

  private addTieBreak(score: number, createdAt: number): number {
    const tie = (createdAt % 1e6) / 1e6;
    return score + tie * 1e-7;
  }

  // ================================
  // ⚡ DIRTY WORKER (REALTIME)
  // ================================
  @Cron("*/1 * * * *")
  async handleDirty() {
    const dirty = await this.redis.spop("post:dirty", this.DIRTY_BATCH);

    if (!dirty?.length) return;

    await this.recomputeScores(dirty, "dirty");
  }

  // ================================
  // 🌱 FRESH WORKER (DECAY)
  // ================================
  @Cron("*/5 * * * *")
  async handleFresh() {
    const now = Date.now();

    const fresh = await this.redis.zrangebyscore(
      "post:fresh",
      now,
      "+inf",
      "LIMIT",
      0,
      this.FRESH_BATCH,
    );

    if (!fresh.length) return;

    await this.recomputeScores(fresh, "fresh");
  }

  // ================================
  // 👑 TOP WORKER (STABILITY)
  // ================================
  @Cron("*/10 * * * *")
  async handleTop() {
    const top = await this.redis.zrevrange("post:score", 0, this.TOP_BATCH);

    if (!top.length) return;

    await this.recomputeScores(top, "top");
  }

  // ================================
  // 🧹 CLEANUP FRESH (TTL giả)
  // ================================
  @Cron("0 * * * *") // mỗi giờ
  async cleanupFresh() {
    const now = Date.now();

    await this.redis.zremrangebyscore("post:fresh", 0, now);
  }

  // ================================
  // 🧹 CLEANUP HARD (OLD POSTS)
  // ================================
  @Cron("0 3 * * *") // 3h sáng
  async cleanupOldPosts() {
    const threshold = Date.now() - 10 * 24 * 60 * 60 * 1000;

    while (true) {
      const oldPosts = await this.redis.zrangebyscore(
        "post:fresh",
        0,
        threshold,
        "LIMIT",
        0,
        500,
      );

      if (!oldPosts.length) break;

      const pipeline = this.redis.pipeline();

      for (const postId of oldPosts) {
        pipeline.zrem("post:score", postId);
        pipeline.zrem("post:fresh", postId);
        pipeline.del(`post:meta:${postId}`);
        pipeline.del(`post:engagement:${postId}`);
        pipeline.del(`post:rank:${postId}`);
      }

      await pipeline.exec();
    }
  }
}
