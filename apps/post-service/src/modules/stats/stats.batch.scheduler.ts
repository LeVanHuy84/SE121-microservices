import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StatsBufferService } from './stats.buffer.service';
import { KafkaProducerService } from '../kafka/kafka.producer.service';
import { EventTopic, StatPayload } from '@repo/dtos';

@Injectable()
export class StatsBatchScheduler {
  private readonly logger = new Logger(StatsBatchScheduler.name);

  constructor(
    private readonly buffer: StatsBufferService,
    private readonly kafka: KafkaProducerService
  ) {}

  @Cron('*/60 * * * * *') // mỗi 60 giây
  async flushStatsToKafka() {
    const allStats = await this.buffer.getAllBufferedStats();
    if (!Object.keys(allStats).length) return;

    const payload: StatPayload = {
      timestamp: Date.now(),
      payload: Object.entries(allStats).map(([postId, data]) => ({
        postId,
        ...data,
      })),
    };

    await this.kafka.sendMessage(EventTopic.STATS, payload);

    for (const postId of Object.keys(allStats)) {
      await this.buffer.clearBuffer(postId);
    }

    this.logger.log(
      `✅ Flushed ${Object.keys(allStats).length} posts to Kafka.`
    );
  }
}
