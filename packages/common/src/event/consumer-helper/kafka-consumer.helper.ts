import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  IdempotencyBusyError,
  IdempotencyService,
} from '../idempotency/idempotency.service';
import { KafkaDLQService } from '../dlq/kafka-dlq.service';
import { retryWithBackoff, RetryOptions } from '../retry/retry.util';
import { KafkaContext } from '@nestjs/microservices';
import { ClientSession, Connection } from 'mongoose';
import { DataSource, EntityManager } from 'typeorm';
import {
  context as contextApi,
  propagation,
  trace,
  SpanStatusCode,
} from '@opentelemetry/api';

@Injectable()
export class KafkaConsumerHelper {
  private readonly logger = new Logger(KafkaConsumerHelper.name);
  private _supportsTransactionsCache: boolean | null = null;

  constructor(
    private readonly dlq: KafkaDLQService,
    @Optional()
    @InjectConnection()
    private readonly connection: Connection | undefined,
    @Optional()
    @InjectDataSource()
    private readonly dataSource?: DataSource,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  private supportsTransactions(): boolean {
    if (this._supportsTransactionsCache !== null) {
      return this._supportsTransactionsCache;
    }
    const client = (this.connection as any)?.getClient?.();
    const topologyType = client?.topology?.description?.type;
    if (topologyType && topologyType !== 'Unknown') {
      this._supportsTransactionsCache = topologyType !== 'Single';
      return this._supportsTransactionsCache;
    }
    return false;
  }

  private extractCarrier(raw: any, message: any): Record<string, string> {
    const carrier: Record<string, string> = {};
    if (raw?.headers) {
      for (const [k, v] of Object.entries(raw.headers)) {
        if (v !== undefined && v !== null) {
          carrier[k] = Buffer.isBuffer(v) ? v.toString('utf-8') : String(v);
        }
      }
    }
    if (
      message?.payload?._traceContext &&
      typeof message.payload._traceContext === 'object'
    ) {
      for (const [k, v] of Object.entries(message.payload._traceContext)) {
        if (v !== undefined && v !== null) {
          carrier[k] = String(v);
        }
      }
    }
    return carrier;
  }

  // =====================================================
  // MONGODB TRANSACTION HANDLER (MAIN)
  // =====================================================
  async handle(params: {
    topic: string;
    eventId: string;
    message: any;
    handler: (session?: ClientSession) => Promise<void>;
    context: KafkaContext;
    retryOptions?: RetryOptions;
    metadata?: Record<string, any>;
  }) {
    if (!this.connection) {
      throw new Error('Mongo connection required');
    }

    if (!this.idempotency) {
      throw new Error('IdempotencyService required');
    }

    const {
      topic,
      eventId,
      message,
      handler,
      context,
      retryOptions,
      metadata,
    } = params;

    if (!eventId) {
      this.logger.warn(`Missing eventId → skip`);
      return;
    }

    const raw = context.getMessage();
    const consumer = context.getConsumer();
    const partition = context.getPartition();
    const nextOffset = (Number(raw.offset) + 1).toString();

    const carrier = this.extractCarrier(raw, message);
    const parentCtx = propagation.extract(contextApi.active(), carrier);
    const tracer = trace.getTracer('kafka-consumer');

    return await contextApi.with(parentCtx, async () => {
      return await tracer.startActiveSpan(
        `kafka:${topic} consume`,
        async (span) => {
          span.setAttribute('messaging.system', 'kafka');
          span.setAttribute('messaging.destination', topic);
          span.setAttribute('messaging.operation', 'process');
          span.setAttribute('messaging.kafka.event_id', eventId);
          span.setAttribute('messaging.kafka.partition', partition);
          span.setAttribute('messaging.kafka.offset', raw.offset);

          let session: ClientSession | undefined;
          const supportsTx = this.supportsTransactions();

          if (supportsTx) {
            try {
              session = await this.connection!.startSession();
            } catch (err) {
              this.logger.warn(`Failed to start Mongo session: ${err}`);
            }
          }

          this.logger.log(
            `[CONSUME] topic=${topic} partition=${partition} offset=${raw.offset} eventId=${eventId}`,
          );

          try {
            // =========================
            // TRANSACTION (With Standalone Mongo Fallback)
            // =========================
            const runHandler = async (txSession?: ClientSession) => {
              await this.idempotency!.execute({
                eventId,
                session: txSession,
                handler: async ({ session: subSession }) => {
                  await retryWithBackoff(
                    () => handler(subSession ?? txSession),
                    retryOptions,
                  );
                },
              });
            };

            if (supportsTx && session) {
              const activeSession = session;
              try {
                await activeSession.withTransaction(
                  async () => runHandler(activeSession),
                  {
                    maxCommitTimeMS: 5000,
                  },
                );
              } catch (txErr: any) {
                if (
                  txErr?.message?.includes('replica set member or mongos') ||
                  txErr?.message?.includes('Transactions are not supported')
                ) {
                  this._supportsTransactionsCache = false;
                  await runHandler();
                } else {
                  throw txErr;
                }
              }
            } else {
              await runHandler();
            }

      // =========================
      // COMMIT OFFSET
      // =========================
      await consumer.commitOffsets([
        {
          topic,
          partition,
          offset: nextOffset,
        },
      ]);

      this.logger.log(
        `[SUCCESS] topic=${topic} offset=${raw.offset} eventId=${eventId}`,
      );

      // simulate crash after commit
      if (metadata?.crashAfterCommit) {
        this.logger.error(`[CRASH_AFTER_COMMIT] eventId=${eventId}`);
        process.exit(1);
      }
    } catch (error) {
      // =========================
      // IDEMPOTENCY BUSY
      // =========================
      if (error instanceof IdempotencyBusyError) {
        this.logger.warn(
          `[BUSY] topic=${topic} offset=${raw.offset} eventId=${eventId}`,
        );
        throw error;
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // =========================
      // TRANSACTION ABORT CASE
      // =========================
      const isTxnAborted =
        errorMessage.includes('Transaction') &&
        errorMessage.includes('aborted');

      if (isTxnAborted) {
        this.logger.warn(
          `[TXN_ABORTED] eventId=${eventId} reason=unknown_commit_state`,
        );

        const alreadyDone = await this.idempotency!.isDone(eventId);

        if (alreadyDone) {
          this.logger.warn(
            `[RECOVER] eventId=${eventId} → already DONE → commit offset`,
          );

          await consumer.commitOffsets([
            {
              topic,
              partition,
              offset: nextOffset,
            },
          ]);

          return;
        }

        // retry again (important)
        throw error;
      }

      // =========================
      // DLQ
      // =========================
      this.logger.error(
        `[ERROR] topic=${topic} offset=${raw.offset} eventId=${eventId} error=${errorMessage}`,
      );

      await this.dlq.send(topic, message, error, {
        eventId,
        ...metadata,
      });

      await consumer.commitOffsets([
        {
          topic,
          partition,
          offset: nextOffset,
        },
      ]);

      this.logger.warn(`[DLQ_COMMIT] eventId=${eventId} offset=${nextOffset}`);
    } finally {
      if (session) {
        try {
          await session.endSession();
        } catch {}
      }
      span.end();
    }
        },
      );
    });
  }

  // =====================================================
  // TYPEORM VERSION
  // =====================================================
  async handleWithTypeOrm(params: {
    topic: string;
    eventId: string;
    message: any;
    handler: (manager: EntityManager) => Promise<void>;
    context: KafkaContext;
    retryOptions?: RetryOptions;
    metadata?: Record<string, any>;
  }) {
    if (!this.dataSource) {
      throw new Error('DataSource required');
    }

    if (!this.idempotency) {
      throw new Error('IdempotencyService required');
    }

    const {
      topic,
      eventId,
      message,
      handler,
      context,
      retryOptions,
      metadata,
    } = params;

    const raw = context.getMessage();
    const consumer = context.getConsumer();
    const partition = context.getPartition();
    const nextOffset = (Number(raw.offset) + 1).toString();

    const carrier = this.extractCarrier(raw, message);
    const parentCtx = propagation.extract(contextApi.active(), carrier);
    const tracer = trace.getTracer('kafka-consumer');

    return await contextApi.with(parentCtx, async () => {
      return await tracer.startActiveSpan(
        `kafka:${topic} consume`,
        async (span) => {
          span.setAttribute('messaging.system', 'kafka');
          span.setAttribute('messaging.destination', topic);
          span.setAttribute('messaging.operation', 'process');
          span.setAttribute('messaging.kafka.event_id', eventId);
          span.setAttribute('messaging.kafka.partition', partition);
          span.setAttribute('messaging.kafka.offset', raw.offset);

          const queryRunner = this.dataSource!.createQueryRunner();

          try {
            await queryRunner.connect();
            await queryRunner.startTransaction();

            await this.idempotency!.execute({
              eventId,
              manager: queryRunner.manager,
              handler: async ({ manager }) => {
                await retryWithBackoff(
                  () => handler(manager ?? queryRunner.manager),
                  retryOptions,
                );
              },
            });

            await queryRunner.commitTransaction();

            await consumer.commitOffsets([
              { topic, partition, offset: nextOffset },
            ]);

            if (metadata?.crashAfterCommit) {
              process.exit(1);
            }
          } catch (error) {
            span.recordException(error as Error);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: (error as Error)?.message,
            });

            try {
              await queryRunner.rollbackTransaction();
            } catch {}

            if (error instanceof IdempotencyBusyError) {
              throw error;
            }

            await this.dlq.send(topic, message, error, {
              eventId,
              ...metadata,
            });

            await consumer.commitOffsets([
              { topic, partition, offset: nextOffset },
            ]);
          } finally {
            await queryRunner.release();
            span.end();
          }
        },
      );
    });
  }

  // =====================================================
  // STATELESS
  // =====================================================
  async handleStateless(params: {
    topic: string;
    eventId: string;
    message: any;
    handler: () => Promise<void>;
    context: KafkaContext;
    retryOptions?: RetryOptions;
    metadata?: Record<string, any>;
  }) {
    const {
      topic,
      eventId,
      message,
      handler,
      context,
      retryOptions,
      metadata,
    } = params;

    const raw = context.getMessage();
    const consumer = context.getConsumer();
    const partition = context.getPartition();
    const nextOffset = (Number(raw.offset) + 1).toString();

    try {
      await retryWithBackoff(handler, retryOptions);

      await consumer.commitOffsets([{ topic, partition, offset: nextOffset }]);
    } catch (error) {
      await this.dlq.send(topic, message, error, {
        eventId,
        ...metadata,
      });

      await consumer.commitOffsets([{ topic, partition, offset: nextOffset }]);
    }
  }
}
