import { Inject, Injectable } from '@nestjs/common';
import type { IdempotencyRepository } from './idempotency.interface';
import { Logger } from '@nestjs/common';
import type { ClientSession } from 'mongoose';
import type { EntityManager } from 'typeorm';

export class IdempotencyBusyError extends Error {
  constructor(eventId: string) {
    super(`Event ${eventId} is already being processed`);
    this.name = 'IdempotencyBusyError';
  }
}

const DEFAULT_STALE_AFTER_MS = 10_000;
const CLAIM_RETRY_INTERVAL_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface IdempotencyExecuteParams {
  eventId: string;
  handler: (context: {
    session?: ClientSession;
    manager?: EntityManager;
  }) => Promise<void>;
  session?: ClientSession;
  manager?: EntityManager;
  staleAfterMs?: number;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    @Inject('IdempotencyRepository')
    private readonly repo: IdempotencyRepository,
  ) {}

  async execute(params: IdempotencyExecuteParams) {
    const {
      eventId,
      handler,
      session,
      manager,
      staleAfterMs = DEFAULT_STALE_AFTER_MS,
    } = params;

    const acquireDeadline = Date.now() + staleAfterMs + CLAIM_RETRY_INTERVAL_MS;
    let attempt = 0;

    while (true) {
      attempt += 1;
      const started = await this.repo.tryStart({
        eventId,
        staleAfterMs,
        session,
        manager,
      });

      this.logger.log(
        `[TRACE][idempotency:claim] eventId=${eventId} attempt=${attempt} result=${started}`,
      );

      if (started === 'DONE') {
        this.logger.log(
          `[TRACE][idempotency:skip] eventId=${eventId} reason=already_done`,
        );
        return;
      }

      if (started === 'STARTED') {
        this.logger.log(
          `[TRACE][idempotency:claimed] eventId=${eventId} attempt=${attempt}`,
        );
        break;
      }

      if (Date.now() >= acquireDeadline) {
        this.logger.warn(
          `[TRACE][idempotency:timeout] eventId=${eventId} attempt=${attempt} staleWindowMs=${staleAfterMs}`,
        );
        throw new IdempotencyBusyError(eventId);
      }

      this.logger.warn(
        `[TRACE][idempotency:wait] eventId=${eventId} nextRetryInMs=${CLAIM_RETRY_INTERVAL_MS}`,
      );
      await sleep(CLAIM_RETRY_INTERVAL_MS);
    }

    try {
      this.logger.log(`[TRACE][idempotency:handler:start] eventId=${eventId}`);
      await handler({ session, manager });
      this.logger.log(`[TRACE][idempotency:handler:done] eventId=${eventId}`);
    } catch (error) {
      this.logger.error(
        `[TRACE][idempotency:handler:error] eventId=${eventId} error=${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }

    await this.repo.markDone({ eventId, session, manager });
    this.logger.log(`[TRACE][idempotency:mark-done] eventId=${eventId}`);
  }

  async isDone(
    eventId: string,
    session?: ClientSession,
    manager?: EntityManager,
  ): Promise<boolean> {
    return this.repo.isDone({ eventId, session, manager });
  }
}
