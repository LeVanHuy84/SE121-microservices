import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { KafkaProducerService } from '@repo/common';
import { EventDestination } from '@repo/dtos';
import { Repository } from 'typeorm';
import { OutboxEventEntity } from 'src/postgres/entities/outbox-event.entity';

@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);
  private running = false;

  constructor(
    @InjectRepository(OutboxEventEntity)
    private readonly outboxRepo: Repository<OutboxEventEntity>,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async handleOutboxBatch() {
    if (this.running) {
      this.logger.debug('Outbox job is still running, skipping this tick');
      return;
    }

    this.running = true;
    try {
      await this.processBatch();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to process social outbox batch: ${message}`);
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

    for (const event of events) {
      const locked = await this.lockEvent(event.id);
      if (!locked) {
        continue;
      }

      await this.processEvent(event);
    }
  }

  private async lockEvent(id: string): Promise<boolean> {
    const result = await this.outboxRepo
      .createQueryBuilder()
      .update(OutboxEventEntity)
      .set({ processed: true })
      .where('id = :id AND processed = false', { id })
      .execute();

    return result.affected === 1;
  }

  private async processEvent(event: OutboxEventEntity) {
    try {
      if (event.destination !== EventDestination.KAFKA) {
        this.logger.warn(
          `Skipping unsupported social outbox destination=${event.destination} id=${event.id}`,
        );
        return;
      }

      await this.kafkaProducer.sendMessage(
        event.topic,
        {
          type: event.eventType,
          payload: event.payload,
        },
        this.getPartitionKey(event),
      );
    } catch (error) {
      await this.outboxRepo.update({ id: event.id }, { processed: false });
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to publish social outbox event ${event.id}: ${message}`,
      );
    }
  }

  private getPartitionKey(event: OutboxEventEntity): string {
    const payload = event.payload as any;
    if (!payload || typeof payload !== 'object') {
      return event.id;
    }

    const userId = payload.userId;
    const targetUserId = payload.targetUserId || payload.candidateId;

    if (userId && targetUserId) {
      // Sort IDs to ensure the pair always hashes to the same partition
      // regardless of who sent the request and who received it
      const ids = [String(userId), String(targetUserId)].sort();
      return ids.join('::');
    }

    if (userId) {
      return String(userId);
    }

    return event.id;
  }
}
