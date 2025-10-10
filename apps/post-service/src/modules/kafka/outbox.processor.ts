import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { KafkaProducerService } from './kafka.producer.service';

@Injectable()
export class OutboxProcessor implements OnModuleInit {
  private readonly logger = new Logger(OutboxProcessor.name);
  private running = false;

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
    private readonly kafkaProducer: KafkaProducerService
  ) {}

  async onModuleInit() {
    this.logger.log('✅ OutboxProcessor initialized');
    this.runLoop();
  }

  private async runLoop() {
    while (true) {
      if (this.running) {
        await this.sleep(2000);
        continue;
      }

      this.running = true;
      try {
        await this.processBatch();
      } catch (err) {
        this.logger.error(`❌ Outbox loop error: ${err.message}`, err.stack);
      } finally {
        this.running = false;
      }

      await this.sleep(2000);
    }
  }

  private async processBatch() {
    // lấy 1 batch event chưa xử lý
    const events = await this.outboxRepo
      .createQueryBuilder('e')
      .where('e.processed = false')
      .orderBy('e.createdAt', 'ASC')
      .limit(100)
      .getMany();

    if (events.length === 0) return;

    for (const event of events) {
      const locked = await this.lockEvent(event.id);
      if (!locked) continue; // có thread khác đang xử lý

      await this.processEvent(event);
    }
  }

  /**
   * Đánh dấu 1 event đang được xử lý (atomic update)
   * return true nếu lock thành công, false nếu đã bị xử lý hoặc thread khác lấy trước
   */
  private async lockEvent(id: string): Promise<boolean> {
    const result = await this.outboxRepo
      .createQueryBuilder()
      .update(OutboxEvent)
      .set({ processed: true }) // tạm lock bằng cách set true
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
      // rollback processed=false nếu lỗi
      await this.outboxRepo.update({ id: event.id }, { processed: false });
      this.logger.error(`❌ Error sending event ${event.id}: ${err.message}`);
    }
  }

  private async sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
}
