import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  OutboxEvent,
  OutboxEventDocument,
} from 'src/mongo/schema/outbox.schema';

@Injectable()
export class OutboxService {
  constructor(
    @InjectModel(OutboxEvent.name)
    private readonly outboxModel: Model<OutboxEventDocument>,
  ) {}

  async enqueue(
    topic: string,
    eventType: string,
    payload: Record<string, any>,
    aggregateId?: string,
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

    return outbox.save();
  }
}
