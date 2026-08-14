import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  CreateNotificationDto,
  EventDestination,
  NotificationPayload,
  NotiOutboxPayload,
} from "@repo/dtos";
import { KafkaProducerService, NotificationService } from "@repo/common";
import { DRIZZLE } from "src/drizzle/drizzle.module";
import type { DrizzleDB } from "src/drizzle/types/drizzle";
import { outboxEvents, groups } from "src/drizzle/schema/schema";
import { and, asc, eq } from "drizzle-orm";

@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);
  private running = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly notificationService: NotificationService,
  ) {
    this.logger.log("🧩 Unified OutboxProcessor initialized (Drizzle)");
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async handleOutboxBatch() {
    if (this.running) {
      this.logger.debug("⏳ Outbox job still running, skipping...");
      return;
    }

    this.running = true;
    try {
      await this.processBatch();
    } catch (err: any) {
      this.logger.error(`💥 Outbox job error: ${err.message}`, err.stack);
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

    this.logger.debug(`📦 Processing ${events.length} outbox events...`);

    for (const event of events) {
      const locked = await this.lockEvent(event.id);
      if (!locked) continue;
      await this.processEvent(event);
    }
  }

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
            this.getPartitionKey(event),
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
    } catch (err: any) {
      await this.db
        .update(outboxEvents)
        .set({ processed: false })
        .where(eq(outboxEvents.id, id));
      this.logger.error(`❌ Error sending event ${id}: ${err.message}`);
    }
  }

  private async toNotificationDtos(
    outbox: any,
  ): Promise<CreateNotificationDto[]> {
    const outboxPayload = outbox.payload as NotiOutboxPayload;
    const receivers = (outboxPayload?.receivers || []).filter(
      (r): r is string => typeof r === "string" && r.trim().length > 0,
    );

    let actorName = outboxPayload.actorName;
    let actorAvatar = outboxPayload.actorAvatar;

    if (
      !actorName &&
      (outboxPayload.targetType as string) === "group" &&
      outboxPayload.targetId
    ) {
      const [group] = await this.db
        .select({ name: groups.name, avatar: groups.avatar })
        .from(groups)
        .where(eq(groups.id, outboxPayload.targetId))
        .limit(1);

      if (group) {
        actorName = group.name;
        actorAvatar = (group.avatar as any)?.url;
      }
    }

    const payload: NotificationPayload = {
      targetId: outboxPayload.targetId,
      targetType: outboxPayload.targetType,
      actorName,
      actorAvatar,
      content: outboxPayload.content,
    };

    return receivers.map((receiver) => ({
      requestId: outboxPayload.requestId ?? outbox.id,
      userId: receiver,
      type: outbox.eventType,
      payload,
      sendAt: new Date(),
      meta: { priority: 1, maxRetries: 3 },
      channels: [],
    }));
  }

  private getPartitionKey(event: any): string {
    const payload = event.payload;
    if (!payload || typeof payload !== "object") {
      return event.id;
    }

    const userId = payload.userId;
    const targetUserId = payload.targetUserId || payload.candidateId;

    if (userId && targetUserId) {
      const ids = [String(userId), String(targetUserId)].sort();
      return ids.join("::");
    }

    if (userId) {
      return String(userId);
    }

    return event.id;
  }
}
