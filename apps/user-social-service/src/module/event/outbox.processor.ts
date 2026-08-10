import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Inject } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';

import { KafkaProducerService, NotificationService } from '@repo/common';
import {
  CreateNotificationDto,
  EventDestination,
  NotificationPayload,
  NotiOutboxPayload,
} from '@repo/dtos';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import type { DrizzleDB } from 'src/drizzle/types/drizzle';
import { outboxEvents } from 'src/drizzle/schema/outbox.schema';

@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);
  private running = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly notificationService: NotificationService
  ) {
    this.logger.log('🧩 OutboxProcessor initialized (Drizzle)');
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async handleOutboxBatch() {
    if (this.running) {
      this.logger.debug('⏳ Job still running -> skip');
      return;
    }

    this.running = true;

    try {
      await this.processBatch();
    } finally {
      this.running = false;
    }
  }

  private async processBatch() {
    const events = await this.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.processed, false))
      .orderBy(asc(outboxEvents.createdAt))
      .limit(100);

    if (events.length === 0) return;

    this.logger.debug(`📦 Processing ${events.length} events...`);

    for (const event of events) {
      const locked = await this.lockEvent(event.id);
      if (!locked) continue;

      await this.processEvent(event);
    }
  }

  /**
   * Atomic lock bằng UPDATE ... WHERE processed = false
   */
  private async lockEvent(id: string): Promise<boolean> {
    const result = await this.db
      .update(outboxEvents)
      .set({ processed: true })
      .where(and(eq(outboxEvents.id, id), eq(outboxEvents.processed, false)));

    return result.rowCount === 1;
  }

  private async processEvent(event: any) {
    const { id, destination, topic, eventType, payload } = event;

    try {
      switch (destination) {
        case EventDestination.KAFKA:
          await this.kafkaProducer.sendMessage(
            topic,
            { type: eventType, payload },
            id
          );
          this.logger.debug(`✅ Kafka sent ${id}`);
          break;

        case EventDestination.RABBITMQ:
          const notis = this.toNotificationDtos(event);

          await Promise.all(
            notis.map((noti) => this.notificationService.sendNotification(noti))
          );
          this.logger.debug(`✅ RabbitMQ sent ${id}`);
          break;

        default:
          this.logger.warn(`⚠ Unknown destination: ${destination}`);
      }
    } catch (err) {
      // unlock
      await this.db
        .update(outboxEvents)
        .set({ processed: false })
        .where(eq(outboxEvents.id, id));

      this.logger.error(`❌ Failed event ${id}: ${err.message}`);
    }
  }

  // Cần cải tạo để dùng
  private toNotificationDtos(outbox): CreateNotificationDto[] {
    const outboxPayload = outbox.payload as NotiOutboxPayload;

    const receivers = outboxPayload.receivers;
    const payload: NotificationPayload = {
      targetId: outboxPayload.targetId,
      targetType: outboxPayload.targetType,
      actorName: outboxPayload.actorName,
      actorAvatar: outboxPayload.actorAvatar,
      content: outboxPayload.content,
    };

    return receivers.map((receiver) => {
      return {
        requestId: outboxPayload.requestId ?? outbox.id,
        userId: receiver, // hoặc map từng user nếu cần
        type: outbox.eventType,
        payload, // phần còn lại tự động gộp
        sendAt: new Date(),
        meta: { priority: 1, maxRetries: 3 },
        channels: [],
      };
    });
  }
}
