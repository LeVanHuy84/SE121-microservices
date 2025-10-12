import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { StatsPayload, StatsEventType } from '@repo/dtos';

@Injectable()
export class StatsIngestionService {
  private readonly logger = new Logger(StatsIngestionService.name);
  private readonly SCORE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 ngày

  constructor(@InjectRedis() private readonly redis: Redis) {}

  private weightFor(type: StatsEventType): number {
    switch (type) {
      case StatsEventType.REACTION:
        return 1;
      case StatsEventType.COMMENT:
        return 3;
      case StatsEventType.SHARE:
        return 4;
      default:
        return 0;
    }
  }

  async processStatsBatch(message: StatsPayload) {
    const { timestamp, payload } = message;
    const pipeline = this.redis.pipeline();

    for (const record of payload) {
      const { postId, deltas } = record;
      let totalScoreDelta = 0;

      // Tính tổng điểm delta theo từng loại stats
      for (const [type, count] of Object.entries(deltas)) {
        const weight = this.weightFor(type as StatsEventType);
        if (weight !== 0 && count) totalScoreDelta += weight * count;
      }

      if (totalScoreDelta !== 0) {
        const metaKey = `post:meta:${postId}`;

        // Cập nhật điểm post
        pipeline.zincrby('post:score', totalScoreDelta, postId);

        // Cập nhật meta (vd: lastStatAt)
        pipeline.hset(metaKey, 'lastStatAt', timestamp);
        pipeline.expire(metaKey, this.SCORE_TTL_SECONDS);
      }
    }

    // TTL cho ZSET chính
    pipeline.expire('post:score', this.SCORE_TTL_SECONDS);

    await pipeline.exec();

    this.logger.log(
      `✅ Updated post scores for ${payload.length} posts (ts=${timestamp}).`,
    );
  }
}
