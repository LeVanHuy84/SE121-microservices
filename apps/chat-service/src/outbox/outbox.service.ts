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
    Array<() => Promise<void>>
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
    void aggregateId;

    if (session) {
      const pending = this.pendingChatPublishes.get(session) ?? [];
      pending.push(() => this.chatStreamProducer.publishEvent(eventType, payload));
      this.pendingChatPublishes.set(session, pending);
      return;
    }

    return this.chatStreamProducer.publishEvent(eventType, payload);
  }

  async flushPendingChatEvents(session: ClientSession) {
    const pending = this.pendingChatPublishes.get(session);
    if (!pending?.length) return;

    this.pendingChatPublishes.delete(session);

    for (const publish of pending) {
      await publish();
    }
  }

  clearPendingChatEvents(session: ClientSession) {
    this.pendingChatPublishes.delete(session);
  }
}
