import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { KafkaProducerService } from './kafka.producer.service';

@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);
  private running = false;

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
    private readonly kafkaProducer: KafkaProducerService
  ) {
    this.logger.log('🧩 OutboxProcessor constructed');
  }

  /**
   * 🕒 Chạy mỗi 5 giây (Cron job)
   * Bạn có thể đổi chu kỳ ở đây, ví dụ EVERY_SECOND hoặc EVERY_MINUTE.
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  async handleOutboxBatch() {
    if (this.running) {
      this.logger.debug('⏳ Outbox job still running, skipping...');
      return;
    }

    this.running = true;
    try {
      await this.processBatch();
    } catch (err) {
      this.logger.error(`💥 Outbox job error: ${err.message}`, err.stack);
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

    this.logger.debug(`📦 Processing ${events.length} outbox events...`);

    for (const event of events) {
      const locked = await this.lockEvent(event.id);
      if (!locked) continue;

      await this.processEvent(event);
    }
  }

  /**
   * Đánh dấu event đang xử lý (atomic lock)
   */
  private async lockEvent(id: string): Promise<boolean> {
    const result = await this.outboxRepo
      .createQueryBuilder()
      .update(OutboxEvent)
      .set({ processed: true })
      .where('id = :id AND processed = false', { id })
      .execute();

    return result.affected === 1;
  }

  private async processEvent(event: OutboxEvent) {
    try {
      const { id, topic, eventType, payload } = event;

      await this.kafkaProducer.sendMessage(
        topic,
        { type: eventType, payload },
        id
      );

      this.logger.debug(`✅ Sent event ${id} -> ${topic}`);
    } catch (err) {
      await this.outboxRepo.update({ id: event.id }, { processed: false });
      this.logger.error(`❌ Error sending event ${event.id}: ${err.message}`);
    }
  }
}
