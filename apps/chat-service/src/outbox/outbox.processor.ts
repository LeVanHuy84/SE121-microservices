import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { KafkaProducerService } from '@repo/common';
import {
  OutboxEvent,
  OutboxEventDocument,
} from 'src/mongo/schema/outbox.schema';

@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);
  private readonly chatTopic = 'chat-events';
  private running = false;
  private readonly maxRetries = 10;
  private readonly baseDelayMs = 5000;
  private readonly maxDelayMs = 300000;
  private readonly leaseMs = Number(process.env.OUTBOX_LEASE_MS ?? 60_000);
  private readonly leaseRefreshMs = Math.max(
    5_000,
    Math.floor(this.leaseMs / 3),
  );
  private readonly workerId =
    process.env.HOSTNAME || `chat-outbox-${process.pid}`;

  constructor(
    @InjectModel(OutboxEvent.name)
    private readonly outboxModel: Model<OutboxEventDocument>,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async handleOutboxBatch() {
    if (this.running) {
      // this.logger.debug('Outbox job still running, skipping...');
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
    const now = new Date();
    const staleLockCutoff = new Date(now.getTime() - this.leaseMs);
    const events = await this.outboxModel
      .find({
        processed: false,
        $and: [
          {
            $or: [
              { processing: { $ne: true } },
              { lockedAt: null },
              { lockedAt: { $lte: staleLockCutoff } },
            ],
          },
          {
            $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: now } }],
          },
        ],
      })
      .sort({ createdAt: 1 })
      .limit(100)
      .exec();

    if (events.length === 0) return;

    this.logger.debug(`Processing ${events.length} outbox events...`);

    for (const event of events) {
      const locked = await this.lockEvent(event.id);
      if (!locked) continue;

      await this.processEvent(event);
    }
  }

  private async lockEvent(id: string): Promise<boolean> {
    const now = new Date();
    const staleLockCutoff = new Date(now.getTime() - this.leaseMs);
    const updated = await this.outboxModel
      .findOneAndUpdate(
        {
          _id: id,
          processed: false,
          $and: [
            {
              $or: [
                { processing: { $ne: true } },
                { lockedAt: null },
                { lockedAt: { $lte: staleLockCutoff } },
              ],
            },
            {
              $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: now } }],
            },
          ],
        },
        {
          processing: true,
          lockedAt: now,
          lockedBy: this.workerId,
        },
        { new: true },
      )
      .exec();

    return !!updated;
  }

  private async processEvent(event: OutboxEventDocument) {
    const { id, topic, eventType, payload, aggregateId } = event;
    const leaseRefresher = setInterval(() => {
      this.refreshEventLease(id).catch((err) =>
        this.logger.warn(
          `Failed to refresh outbox lease for ${id}: ${err.message}`,
        ),
      );
    }, this.leaseRefreshMs);

    try {
      if (topic === this.chatTopic) {
        event.processed = true;
        event.processing = false;
        event.lockedAt = undefined;
        event.lockedBy = undefined;
        event.processedAt = new Date();
        event.nextRetryAt = undefined;
        event.lastError = 'skipped_chat_outbox_event';
        await event.save();

        this.logger.warn(
          `Skipped legacy chat outbox event ${id} (${eventType}) because chat events publish directly to Redis stream.`,
        );
        return;
      } else {
        await this.kafkaProducer.sendMessage(
          topic,
          { type: eventType, payload },
          aggregateId || id,
        );
      }

      event.processed = true;
      event.processing = false;
      event.lockedAt = undefined;
      event.lockedBy = undefined;
      event.processedAt = new Date();
      event.nextRetryAt = undefined;
      event.lastError = undefined;
      await event.save();

      this.logger.debug(`Outbox event ${id} processed successfully.`);
    } catch (err) {
      const retryCount = (event.retryCount || 0) + 1;
      const delayMs = Math.min(
        this.baseDelayMs * Math.pow(2, retryCount - 1),
        this.maxDelayMs,
      );
      const nextRetryAt = new Date(Date.now() + delayMs);

      if (retryCount > this.maxRetries) {
        await this.outboxModel.updateOne(
          { _id: id },
          {
            processed: true,
            processing: false,
            lockedAt: null,
            lockedBy: null,
            processedAt: new Date(),
            retryCount,
            lastError: err.message,
          },
        );
        this.logger.error(
          `Outbox event ${id} dropped after ${this.maxRetries} retries: ${err.message}`,
        );
        return;
      }

      await this.outboxModel.updateOne(
        { _id: id },
        {
          processed: false,
          processing: false,
          lockedAt: null,
          lockedBy: null,
          retryCount,
          nextRetryAt,
          lastError: err.message,
        },
      );
      this.logger.error(
        `Failed to process outbox event ${id}, retry #${retryCount} at ${nextRetryAt.toISOString()}: ${err.message}`,
        err.stack,
      );
    } finally {
      clearInterval(leaseRefresher);
    }
  }

  private async refreshEventLease(id: string) {
    await this.outboxModel.updateOne(
      {
        _id: id,
        processed: false,
        processing: true,
        lockedBy: this.workerId,
      },
      {
        $set: {
          lockedAt: new Date(),
        },
      },
    );
  }
}
