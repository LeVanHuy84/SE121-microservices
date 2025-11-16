import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { KafkaService } from '@repo/common';
import { Outbox } from 'src/entities/outbox.entity';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private running = false;
  constructor(
    @InjectRepository(Outbox)
    private readonly outboxRepo: Repository<Outbox>,
    private readonly kafka: KafkaService
  ) {}

  // run every 5s (adjust as needed)
  @Cron('*/5 * * * * *')
  async handleOutboxBatch() {
    if (this.running) {
      this.logger.debug('Outbox job still running, skipping...');
      return;
    }

    this.running = true;
    try {
      await this.processBatch();
    } catch (err) {
      this.logger.error(`Outbox job error: ${err.message}`, err.stack);
    } finally {
      this.running = false;
    }
  }

  private async processBatch() {
    const events = await this.outboxRepo
      .createQueryBuilder('e')
      .where('e.processed = false')
      .orderBy('e.createdAt', 'ASC')
      .limit(100)
      .getMany();

    if (events.length === 0) return;

    this.logger.debug(`Processing ${events.length} outbox events...`);

    for (const event of events) {
      const locked = await this.lockEvent(event.id);
      if (!locked) continue;

      await this.processEvent(event);
    }
  }

  private async lockEvent(id: string): Promise<boolean> {
    const result = await this.outboxRepo
      .createQueryBuilder()
      .update(Outbox)
      .set({ processed: true })
      .where('id = :id AND processed = false', { id })
      .execute();

    return result.affected === 1;
  }

  private async processEvent(event: Outbox) {
    try {
      await this.kafka.send(event.topic, event.payload);

      event.processed = true;
      event.processedAt = new Date();
      await this.outboxRepo.save(event);

      this.logger.debug(`Outbox event ${event.id} processed successfully.`);
    } catch (err) {
      this.logger.error(
        `Failed to process outbox event ${event.id}: ${err.message}`,
        err.stack
      );
      // Optionally implement retry logic or dead-letter queue here
      event.processed = false;

      await this.outboxRepo.save(event);
    }
  }
}
