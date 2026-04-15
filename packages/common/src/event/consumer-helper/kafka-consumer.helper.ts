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

@Injectable()
export class KafkaConsumerHelper {
  private readonly logger = new Logger(KafkaConsumerHelper.name);

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

  async handle(params: {
    topic: string;
    eventId: string;
    message: any;
    handler: (session: ClientSession) => Promise<void>;
    context: KafkaContext;
    retryOptions?: RetryOptions;
    metadata?: Record<string, any>;
  }) {
    if (!this.connection) {
      throw new Error(
        'KafkaConsumerHelper.handle requires a MongoDB connection. Use handleStateless for non-transactional consumers.',
      );
    }

    if (!this.idempotency) {
      throw new Error(
        'KafkaConsumerHelper.handle requires IdempotencyService. Configure IdempotencyModule for transactional consumers.',
      );
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
      this.logger.warn(`Missing eventId → skip message`);
      return;
    }

    const raw = context.getMessage();
    const consumer = context.getConsumer();
    const partition = context.getPartition();
    const nextOffset = (Number(raw.offset) + 1).toString();
    const session = await this.connection.startSession();

    this.logger.log(
      `[CONSUME] topic=${topic} partition=${partition} offset=${raw.offset} eventId=${eventId}`,
    );

    try {
      await session.withTransaction(async () => {
        await this.idempotency!.execute({
          eventId,
          session,
          handler: async ({ session: txSession }) => {
            await retryWithBackoff(
              () => handler(txSession ?? session),
              retryOptions,
            );
          },
        });
      });

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

      if (metadata?.crashAfterCommit) {
        this.logger.error(
          `[CRASH_AFTER_COMMIT] topic=${topic} offset=${raw.offset} eventId=${eventId}`,
        );
        process.exit(1);
      }
    } catch (error) {
      if (error instanceof IdempotencyBusyError) {
        this.logger.warn(
          `[BUSY] topic=${topic} offset=${raw.offset} eventId=${eventId}`,
        );
        throw error;
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const isMongoTransactionAborted =
        errorMessage.includes('Transaction with { txnNumber') &&
        errorMessage.includes('has been aborted');

      if (isMongoTransactionAborted) {
        this.logger.warn(
          `[TXN_ABORTED] topic=${topic} offset=${raw.offset} eventId=${eventId} message=${errorMessage}`,
        );

        const alreadyDone = await this.idempotency.isDone(eventId);

        if (alreadyDone) {
          this.logger.warn(
            `[TXN_ABORTED_COMMIT] topic=${topic} offset=${raw.offset} eventId=${eventId} reason=idempotency_done`,
          );

          await consumer.commitOffsets([
            {
              topic,
              partition,
              offset: nextOffset,
            },
          ]);

          this.logger.log(
            `[SUCCESS_AFTER_TXN_ABORT] topic=${topic} offset=${raw.offset} eventId=${eventId}`,
          );

          return;
        }

        // Transaction bị abort nhưng DB chưa DONE thì phải retry lại, không DLQ.
        throw error;
      }

      this.logger.error(
        `[ERROR] topic=${topic} offset=${raw.offset} eventId=${eventId} error=${
          errorMessage
        }`,
      );

      await this.dlq.send(topic, message, error, {
        eventId,
        ...metadata,
      });

      this.logger.warn(
        `[DLQ] topic=${topic} offset=${raw.offset} eventId=${eventId}`,
      );

      await consumer.commitOffsets([
        {
          topic,
          partition,
          offset: nextOffset,
        },
      ]);

      this.logger.warn(
        `[DLQ_COMMIT] topic=${topic} offset=${raw.offset} committedOffset=${nextOffset} eventId=${eventId}`,
      );

      // Đã chuyển sang DLQ thì không retry lại message gốc.
      return;
    } finally {
      await session.endSession();
    }
  }

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
      throw new Error(
        'KafkaConsumerHelper.handleWithTypeOrm requires a TypeORM DataSource.',
      );
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
      this.logger.warn(`Missing eventId → skip message`);
      return;
    }

    const raw = context.getMessage();
    const consumer = context.getConsumer();
    const partition = context.getPartition();
    const nextOffset = (Number(raw.offset) + 1).toString();
    const queryRunner = this.dataSource.createQueryRunner();

    this.logger.log(
      `[CONSUME] topic=${topic} partition=${partition} offset=${raw.offset} eventId=${eventId}`,
    );

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      await this.idempotency!.execute({
        eventId,
        manager: queryRunner.manager,
        handler: async ({ manager: txManager }) => {
          await retryWithBackoff(
            () => handler(txManager ?? queryRunner.manager),
            retryOptions,
          );
        },
      });

      await queryRunner.commitTransaction();

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

      if (metadata?.crashAfterCommit) {
        this.logger.error(
          `[CRASH_AFTER_COMMIT] topic=${topic} offset=${raw.offset} eventId=${eventId}`,
        );
        process.exit(1);
      }
    } catch (error) {
      try {
        await queryRunner.rollbackTransaction();
      } catch {
        // ignore rollback errors
      }

      if (error instanceof IdempotencyBusyError) {
        this.logger.warn(
          `[BUSY] topic=${topic} offset=${raw.offset} eventId=${eventId}`,
        );
        throw error;
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `[ERROR] topic=${topic} offset=${raw.offset} eventId=${eventId} error=${errorMessage}`,
      );

      await this.dlq.send(topic, message, error, {
        eventId,
        ...metadata,
      });

      this.logger.warn(
        `[DLQ] topic=${topic} offset=${raw.offset} eventId=${eventId}`,
      );

      await consumer.commitOffsets([
        {
          topic,
          partition,
          offset: nextOffset,
        },
      ]);

      this.logger.warn(
        `[DLQ_COMMIT] topic=${topic} offset=${raw.offset} committedOffset=${nextOffset} eventId=${eventId}`,
      );

      return;
    } finally {
      await queryRunner.release();
    }
  }
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

    if (!eventId) {
      this.logger.warn(`Missing eventId → skip message`);
      return;
    }

    const raw = context.getMessage();
    const consumer = context.getConsumer();
    const partition = context.getPartition();
    const nextOffset = (Number(raw.offset) + 1).toString();

    this.logger.log(
      `[CONSUME] topic=${topic} partition=${partition} offset=${raw.offset} eventId=${eventId}`,
    );

    try {
      await retryWithBackoff(handler, retryOptions);

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
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `[ERROR] topic=${topic} offset=${raw.offset} eventId=${eventId} error=${errorMessage}`,
      );

      await this.dlq.send(topic, message, error, {
        eventId,
        ...metadata,
      });

      this.logger.warn(
        `[DLQ] topic=${topic} offset=${raw.offset} eventId=${eventId}`,
      );

      await consumer.commitOffsets([
        {
          topic,
          partition,
          offset: nextOffset,
        },
      ]);

      this.logger.warn(
        `[DLQ_COMMIT] topic=${topic} offset=${raw.offset} committedOffset=${nextOffset} eventId=${eventId}`,
      );

      return;
    }
  }
}
