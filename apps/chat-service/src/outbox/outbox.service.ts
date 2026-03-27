import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import {
  OutboxEvent,
  OutboxEventDocument,
} from 'src/mongo/schema/outbox.schema';

@Injectable()
export class OutboxService {
  private readonly chatTopic = 'chat-events';

  constructor(
    @InjectModel(OutboxEvent.name)
    private readonly outboxModel: Model<OutboxEventDocument>,
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
    return this.enqueue(
      this.chatTopic,
      eventType,
      payload,
      aggregateId,
      session,
    );
  }
}
