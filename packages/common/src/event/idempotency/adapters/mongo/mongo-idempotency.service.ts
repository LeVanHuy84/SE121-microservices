import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  IdempotencyContext,
  IdempotencyRepository,
} from '../../idempotency.interface';
import {
  MongoProcessedEvent,
  MongoProcessedEventDocument,
} from './processed-event.schema';

const DEFAULT_STALE_AFTER_MS = 20_000;

@Injectable()
export class MongoIdempotencyRepository implements IdempotencyRepository {
  constructor(
    @InjectModel(MongoProcessedEvent.name)
    private readonly model: Model<MongoProcessedEventDocument>,
  ) {}

  /**
   * Try to start processing an event
   */
  async tryStart(
    context: IdempotencyContext,
  ): Promise<'STARTED' | 'DONE' | 'BUSY'> {
    const { eventId, staleAfterMs = DEFAULT_STALE_AFTER_MS, session } = context;

    const now = new Date();
    const staleBefore = new Date(now.getTime() - staleAfterMs);

    const claimFilter = {
      _id: eventId,
      $or: [
        { status: { $exists: false } },
        { status: 'FAILED' },
        { status: 'PROCESSING', updatedAt: { $lt: staleBefore } },
      ],
    };

    try {
      const result = await this.model.updateOne(
        claimFilter,
        {
          $set: {
            status: 'PROCESSING',
            updatedAt: now,
          },
          $setOnInsert: {
            _id: eventId,
          },
        },
        { upsert: true, session },
      );

      if (
        result.upsertedCount > 0 ||
        result.modifiedCount > 0 ||
        result.matchedCount > 0
      ) {
        return 'STARTED';
      }

      return 'BUSY';
    } catch (error: any) {
      if (error?.code !== 11000) {
        throw error;
      }

      const existing = await this.model.findById(eventId, undefined, {
        session,
      });

      if (!existing) {
        return 'BUSY';
      }

      if (existing.status === 'DONE') {
        return 'DONE';
      }

      if (
        existing.status === 'PROCESSING' &&
        existing.updatedAt &&
        new Date(existing.updatedAt).getTime() < staleBefore.getTime()
      ) {
        const reclaimed = await this.model.updateOne(
          {
            _id: eventId,
            status: 'PROCESSING',
            updatedAt: { $lt: staleBefore },
          },
          {
            $set: {
              status: 'PROCESSING',
              updatedAt: now,
            },
          },
          { session },
        );

        if (reclaimed.modifiedCount > 0) {
          return 'STARTED';
        }
      }

      return 'BUSY';
    }
  }

  /**
   * Check if event already DONE
   */
  async isDone(context: IdempotencyContext): Promise<boolean> {
    const doc = await this.model.findById(context.eventId, undefined, {
      session: context.session,
    });

    return doc?.status === 'DONE';
  }

  /**
   * Mark event as DONE
   */
  async markDone(context: IdempotencyContext): Promise<void> {
    await this.model.updateOne(
      { _id: context.eventId },
      {
        $set: {
          status: 'DONE',
          updatedAt: new Date(),
        },
      },
      {
        session: context.session,
      },
    );
  }
}
