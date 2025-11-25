import { Inject, Injectable } from '@nestjs/common';
import { EventDestination, EventTopic } from '@repo/dtos';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import { outboxEvents } from 'src/drizzle/schema/schema';
import type { DrizzleDB } from 'src/drizzle/types/drizzle';

@Injectable()
export class OutboxService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  createOutboxEvent(
    destination: EventDestination,
    topic: string,
    eventType: string,
    payload: Record<string, any>
  ) {
    return this.db
      .insert(outboxEvents)
      .values({
        destination,
        topic,
        eventType,
        payload,
      })
      .returning();
  }

  createOutboxEventWithTransaction(
    tx: any,
    destination: EventDestination,
    topic: string,
    eventType: string,
    payload: Record<string, any>
  ) {
    return tx
      .insert(outboxEvents)
      .values({
        destination,
        topic,
        eventType,
        payload,
      })
      .returning();
  }

  createUserOutboxEvent(
    tx: any,
    eventType: string,
    payload: Record<string, any>
  ) {
    return this.createOutboxEventWithTransaction(
      tx,
      EventDestination.KAFKA,
      EventTopic.USER,
      eventType,
      payload
    );
  }
}
