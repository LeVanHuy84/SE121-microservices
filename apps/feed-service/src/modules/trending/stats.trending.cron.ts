import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { Cron, CronExpression } from '@nestjs/schedule';

const DECAY_LAMBDA = 0.08; // tốc độ giảm điểm theo giờ
const MAX_TRENDING = 2000; // số lượng bài trending tối đa

@Injectable()
export class StatsTrendingCron {
  private readonly logger = new Logger(StatsTrendingCron.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  //@Cron(CronExpression.EVERY_10_SECONDS)
  @Cron(CronExpression.EVERY_10_MINUTES)
  async updateTrendingScores() {
    const now = Date.now();

    // 🔹 Lấy toàn bộ postId + score
    const postScores = await this.redis.zrange(
      'post:score',
      0,
      -1,
      'WITHSCORES',
    );
    if (!postScores.length) return;

    const metaPipeline = this.redis.pipeline();
    for (let i = 0; i < postScores.length; i += 2) {
      const postId = postScores[i];
      metaPipeline.hgetall(`post:meta:${postId}`);
    }

    const metaResults = (await metaPipeline.exec()) as [
      Error | null,
      Record<string, string>,
    ][];
    const decayPipeline = this.redis.pipeline();

    const posts: { id: string; score: number; emotion?: string }[] = [];

    // 🔹 Cập nhật decay score
    for (let i = 0; i < metaResults.length; i++) {
      const [, meta] = metaResults[i];
      if (!meta) continue;

      const postId = postScores[i * 2];
      const oldScore = Number(postScores[i * 2 + 1]);

      const createdAt = Number(meta.createdAt ?? now);
      const hoursPassed = (now - createdAt) / 3600000;
      const decayedScore = oldScore * Math.exp(-DECAY_LAMBDA * hoursPassed);

      posts.push({ id: postId, score: decayedScore, emotion: meta.emotion });
      decayPipeline.zadd('post:score', decayedScore, postId);
    }

    await decayPipeline.exec();

    // 🔹 Tạo danh sách trending chung
    const topPosts = posts
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_TRENDING)
      .map((p) => p.id);

    if (topPosts.length) {
      const pipeline = this.redis.pipeline();
      pipeline.del('trending:posts');
      pipeline.rpush('trending:posts', ...topPosts);

      // 🔹 Gom theo emotion và tạo bảng phụ
      const byEmotion = new Map<string, string[]>();
      for (const p of posts) {
        if (p.emotion) {
          const arr = byEmotion.get(p.emotion) ?? [];
          arr.push(p.id);
          byEmotion.set(p.emotion, arr);
        }
      }

      for (const [emotion, ids] of byEmotion.entries()) {
        pipeline.del(`trending:emotion:${emotion}`);
        pipeline.rpush(`trending:emotion:${emotion}`, ...ids.slice(0, 500)); // mỗi emotion giữ tối đa 500 post
      }

      await pipeline.exec();
    }

    this.logger.log(`🔥 Updated trending posts (top ${topPosts.length}).`);
  }
}
