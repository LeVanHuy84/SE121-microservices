import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { ChatStreamProducerService } from 'src/chat-stream-producer/chat-stream-producer.service';
import {
  OutboxEvent,
  OutboxEventDocument,
} from 'src/mongo/schema/outbox.schema';

@Injectable()
export class OutboxService {
  private readonly pendingChatPublishes = new WeakMap<
    ClientSession,
    Array<{
      publish: () => Promise<void>;
      outboxId?: string;
    }>
  >();

  constructor(
    @InjectModel(OutboxEvent.name)
    private readonly outboxModel: Model<OutboxEventDocument>,
    private readonly chatStreamProducer: ChatStreamProducerService,
  ) {}

  async enqueue(
    topic: string,
    eventType: string,
    payload: object,
    aggregateId?: string,
    session?: ClientSession,
  ) {
    const outbox = new this.outboxModel({
      topic,
      eventType,
      payload,
      aggregateId: aggregateId || null,
      processed: false,
      retryCount: 0,
      nextRetryAt: null,
      lastError: null,
    });

    return outbox.save(session ? { session } : undefined);
  }

  async enqueueChatEvent(
    eventType: string,
    payload: object,
    aggregateId?: string,
    session?: ClientSession,
  ) {
    if (session) {
      // Persist fallback outbox event inside transaction with a 10s delay window
      const outbox = new this.outboxModel({
        topic: 'chat-events',
        eventType,
        payload,
        aggregateId: aggregateId || null,
        processed: false,
        retryCount: 0,
        nextRetryAt: new Date(Date.now() + 10_000), // 10s fallback threshold
        lastError: null,
      });

      const saved = await outbox.save({ session });
      const outboxId = (saved as any)?.id || (saved as any)?._id?.toString();

      const pending = this.pendingChatPublishes.get(session) ?? [];
      pending.push({
        publish: () => this.chatStreamProducer.publishEvent(eventType, payload),
        outboxId,
      });
      this.pendingChatPublishes.set(session, pending);
      return;
    }

    return this.chatStreamProducer.publishEvent(eventType, payload);
  }

  async flushPendingChatEvents(session: ClientSession) {
    const pending = this.pendingChatPublishes.get(session);
    if (!pending?.length) return;

    this.pendingChatPublishes.delete(session);

    for (const item of pending) {
      await item.publish();
      if (item.outboxId) {
        // Direct Redis stream publish succeeded; mark fallback outbox event processed
        await this.outboxModel
          .updateOne(
            { _id: item.outboxId },
            { $set: { processed: true, processedAt: new Date() } },
          )
          .catch(() => {});
      }
    }
  }

  clearPendingChatEvents(session: ClientSession) {
    this.pendingChatPublishes.delete(session);
  }
}
