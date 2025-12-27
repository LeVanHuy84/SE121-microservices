import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { OutboxEvent } from 'src/entities/outbox.entity';
import {
  CreateNotificationDto,
  EventDestination,
  NotificationPayload,
  NotiOutboxPayload,
} from '@repo/dtos';
import { KafkaProducerService, NotificationService } from '@repo/common';
import { GroupService } from '../group-core/group/group.service';

@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);
  private running = false;

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly notificationService: NotificationService,
    private readonly groupService: GroupService,
  ) {
    this.logger.log('🧩 OutboxProcessor initialized');
  }

  /**
   * 🕒 Cron chạy mỗi 5 giây để xử lý batch Outbox
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

  /**
   * Gửi sự kiện đến đích tương ứng (Kafka hoặc RabbitMQ)
   */
  private async processEvent(event: OutboxEvent) {
    const { id, destination, topic, eventType, payload } = event;

    try {
      switch (destination) {
        case EventDestination.KAFKA:
          await this.kafkaProducer.sendMessage(
            topic,
            { type: eventType, payload },
            id,
          );
          this.logger.debug(`✅ [Kafka] Sent event ${id} -> ${topic}`);
          break;

        case EventDestination.RABBITMQ: {
          const notis = await this.toNotificationDtos(event);

          await Promise.all(
            notis.map((noti) =>
              this.notificationService.sendNotification(noti),
            ),
          );
          this.logger.debug(`✅ [RabbitMQ] Sent event ${id} -> ${topic}`);
          break;
        }

        default:
          this.logger.warn(
            `⚠️ Unknown destination "${destination}" for event ${id}`,
          );
          break;
      }
    } catch (err) {
      await this.outboxRepo.update({ id }, { processed: false });
      this.logger.error(`❌ Error sending event ${id}: ${err.message}`);
    }
  }

  // HELPERS
  private async toNotificationDtos(
    outbox: OutboxEvent,
  ): Promise<CreateNotificationDto[]> {
    const group = await this.groupService.findById(outbox.payload.groupId);
    const outboxPayload = outbox.payload as NotiOutboxPayload;

    const receivers = outboxPayload.receivers;
    const payload: NotificationPayload = {
      targetId: outboxPayload.targetId,
      targetType: outboxPayload.targetType,
      actorName: group.name,
      actorAvatar: group.avatarUrl,
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
