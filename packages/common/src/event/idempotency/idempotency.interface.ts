import type { ClientSession } from 'mongoose';
import type { EntityManager } from 'typeorm';

export interface IdempotencyContext {
  eventId: string;
  staleAfterMs?: number;
  session?: ClientSession;
  manager?: EntityManager;
}

export interface IdempotencyRepository {
  tryStart(context: IdempotencyContext): Promise<'STARTED' | 'DONE' | 'BUSY'>;
  markDone(context: IdempotencyContext): Promise<void>;
  isDone(context: IdempotencyContext): Promise<boolean>;
}
