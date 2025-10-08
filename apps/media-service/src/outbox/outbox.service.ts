import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { KafkaService } from '@repo/common';
import { Outbox } from 'src/entities/outbox.entity';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(Outbox)
    private readonly outboxRepo: Repository<Outbox>,
    private readonly kafka: KafkaService
  ) {}

  // run every 2s (adjust as needed)
  @Cron('*/2 * * * * *')
  async process() {
    const events = await this.outboxRepo.find({
      where: { published: false },
      take: 20,
    });
    for (const e of events) {
      try {
        await this.kafka.send(e.eventType, e.payload);
        e.published = true;
        e.publishedAt = new Date();
        await this.outboxRepo.save(e);
      } catch (err) {
        this.logger.error('Failed to publish outbox event', err);
        // retry later, consider exponential backoff or dead-letter
      }
    }
  }
}
