import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { Cron, CronExpression } from '@nestjs/schedule';

const DECAY_LAMBDA = 0.15; // tốc độ giảm mỗi ngày

@Injectable()
export class StatsTrendingCron {
  private readonly logger = new Logger(StatsTrendingCron.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async decayTrendingScores() {
    const now = Date.now();
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
      metaPipeline.hget(`post:meta:${postId}`, 'createdAt');
    }

    const results = (await metaPipeline.exec()) as [
      Error | null,
      string | null,
    ][];
    const decayPipeline = this.redis.pipeline();

    for (let i = 0; i < results.length; i++) {
      const [, createdAtStr] = results[i];
      const createdAt = createdAtStr ? Number(createdAtStr) : now;
      const oldScore = Number(postScores[i * 2 + 1]);

      const daysPassed = (now - createdAt) / 86400000;
      const decayedScore = oldScore / (1 + DECAY_LAMBDA * daysPassed);

      const postId = postScores[i * 2];
      decayPipeline.zadd('post:score', decayedScore, postId);
    }

    await decayPipeline.exec();
    this.logger.log(`🕒 Decayed ${results.length} post scores`);
  }
}
