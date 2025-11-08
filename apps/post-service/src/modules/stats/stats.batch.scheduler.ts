import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StatsBufferService } from './stats.buffer.service';
import {
  EventDestination,
  EventTopic,
  ReactionType,
  StatsCommentDelta,
  StatsEventType,
  StatsPayload,
  StatsReactionDelta,
  StatsShareDelta,
  TargetType,
} from '@repo/dtos';
import { InjectRepository } from '@nestjs/typeorm';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { Repository } from 'typeorm';

@Injectable()
export class StatsBatchScheduler {
  private readonly logger = new Logger(StatsBatchScheduler.name);

  constructor(
    private readonly buffer: StatsBufferService,
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>
  ) {
    console.log('🔥 StatsBatchScheduler initialized');
  }

  @Cron('*/10 * * * * *') // mỗi 10 giây
  async flushStatsToKafka() {
    const allStats = await this.buffer.getAllBufferedStats();
    const payload: StatsPayload = {
      timestamp: Date.now(),
      stats: [],
    };

    const clearedBuffers: { targetType: TargetType; targetId: string }[] = [];

    for (const targetType of Object.values(TargetType)) {
      const entries = allStats[targetType];
      if (!entries) continue;

      for (const [targetId, fields] of Object.entries(entries)) {
        const deltas = Object.entries(fields).map(([key, value]) => {
          if (key.startsWith(StatsEventType.REACTION)) {
            const [, reactionType] = key.split(':');
            return {
              type: StatsEventType.REACTION,
              reactionType: reactionType as ReactionType,
              delta: Number(value),
            } as const satisfies StatsReactionDelta;
          } else if (key === StatsEventType.COMMENT) {
            return {
              type: StatsEventType.COMMENT,
              delta: Number(value),
            } as const satisfies StatsCommentDelta;
          } else if (key === StatsEventType.SHARE) {
            return {
              type: StatsEventType.SHARE,
              delta: Number(value),
            } as const satisfies StatsShareDelta;
          } else {
            throw new Error(`Unknown stat key: ${key}`);
          }
        });

        payload.stats.push({
          targetType,
          targetId,
          deltas,
        });

        clearedBuffers.push({ targetType, targetId });
      }
    }

    if (!payload.stats.length) return;

    const outboxEvent = this.outboxRepo.create({
      topic: EventTopic.STATS,
      destination: EventDestination.KAFKA,
      eventType: 'stats.batch',
      payload,
    });
    await this.outboxRepo.save(outboxEvent);

    await this.buffer.clearMultipleBuffers(clearedBuffers);

    this.logger.log(
      `✅ Flushed ${payload.stats.length} stat records (${clearedBuffers.length} buffers) to Kafka.`
    );
  }
}
