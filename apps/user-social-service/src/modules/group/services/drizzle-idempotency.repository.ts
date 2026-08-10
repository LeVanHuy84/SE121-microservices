import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import type { DrizzleDB } from 'src/drizzle/types/drizzle.d';
import { processedEvents } from 'src/drizzle/schema/outbox.schema';
import type { IdempotencyContext, IdempotencyRepository } from '@repo/common';

@Injectable()
export class DrizzleIdempotencyRepository implements IdempotencyRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private getDb(manager?: any) {
    // If a transaction (manager) is active, use it, else default to db pool
    return manager ?? this.db;
  }

  async tryStart(
    context: IdempotencyContext,
  ): Promise<'STARTED' | 'DONE' | 'BUSY'> {
    const { eventId, manager } = context;
    const db = this.getDb(manager);

    try {
      await db.insert(processedEvents).values({
        eventId,
        done: false,
      });
      return 'STARTED';
    } catch (err: any) {
      // Postgres unique constraint violation state is code 23505
      if (err.code === '23505') {
        const [event] = await db
          .select()
          .from(processedEvents)
          .where(eq(processedEvents.eventId, eventId))
          .limit(1);

        if (event?.done) {
          return 'DONE';
        }

        return 'BUSY';
      }
      throw err;
    }
  }

  async isDone(context: IdempotencyContext): Promise<boolean> {
    const { eventId, manager } = context;
    const db = this.getDb(manager);

    const [event] = await db
      .select()
      .from(processedEvents)
      .where(eq(processedEvents.eventId, eventId))
      .limit(1);

    return event?.done ?? false;
  }

  async markDone(context: IdempotencyContext): Promise<void> {
    const { eventId, manager } = context;
    const db = this.getDb(manager);

    await db
      .update(processedEvents)
      .set({ done: true })
      .where(eq(processedEvents.eventId, eventId));
  }
}
