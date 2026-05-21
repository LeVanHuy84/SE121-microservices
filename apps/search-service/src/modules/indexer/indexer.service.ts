import { Client } from '@elastic/elasticsearch';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ELASTIC_CLIENT } from 'src/elastic/elastic.module';

@Injectable()
export class IndexerService implements OnApplicationShutdown {
  private readonly logger = new Logger(IndexerService.name);

  private readonly buffer: Record<string, any[]> = {};
  private readonly flushing: Record<string, boolean> = {};

  /**
   * 1 document = 2 operations
   * [meta, source]
   */
  private readonly BULK_LIMIT = 500;

  /**
   * Flush interval fallback
   * Tránh doc nằm buffer quá lâu khi traffic thấp
   */
  private readonly FLUSH_INTERVAL = 5000;

  private readonly flushTimer: NodeJS.Timeout;

  constructor(@Inject(ELASTIC_CLIENT) private readonly es: Client) {
    this.flushTimer = setInterval(() => {
      void this.flushAll();
    }, this.FLUSH_INTERVAL);
  }

  /**
   * Add action vào bulk buffer
   */
  addToBulk(index: string, actionMeta: any, source?: any) {
    if (!this.buffer[index]) {
      this.buffer[index] = [];
    }

    // Push meta
    this.buffer[index].push(actionMeta);

    // Push source nếu có
    if (source !== undefined) {
      this.buffer[index].push(source);
    }

    this.logger.debug(`Buffered action for index "${index}"`);

    /**
     * Flush ngay nếu vượt limit
     */
    if (this.buffer[index].length >= this.BULK_LIMIT) {
      void this.flushIndex(index);
    }
  }

  /**
   * Flush 1 index
   */
  async flushIndex(index: string): Promise<void> {
    /**
     * Tránh concurrent flush cùng index
     */
    if (this.flushing[index]) {
      return;
    }

    const actions = this.buffer[index];

    if (!actions?.length) {
      return;
    }

    this.flushing[index] = true;

    try {
      /**
       * Reset buffer trước khi gửi
       * để request mới vẫn tiếp tục buffer được
       */
      this.buffer[index] = [];

      await this.executeBulk(index, actions);
    } finally {
      this.flushing[index] = false;

      /**
       * Race condition protection
       *
       * Trong lúc flush có thể có data mới add vào.
       * Nếu có thì flush thêm lần nữa.
       */
      if (this.buffer[index]?.length) {
        void this.flushIndex(index);
      }
    }
  }

  /**
   * Execute bulk request
   */
  private async executeBulk(
    index: string,
    actions: any[],
    attempt = 1,
  ): Promise<void> {
    try {
      const res = await this.es.bulk({
        refresh: false,
        operations: actions,
      });

      /**
       * Partial errors
       */
      if (res.errors) {
        const retryActions: any[] = [];

        res.items.forEach((item, i) => {
          const actionType = Object.keys(item)[0];
          const actionResult = item[actionType];

          if (actionResult.error) {
            /**
             * Mỗi document = 2 operations
             */
            retryActions.push(actions[i * 2]);

            if (actions[i * 2 + 1]) {
              retryActions.push(actions[i * 2 + 1]);
            }
          }
        });

        if (retryActions.length > 0) {
          if (attempt <= 3) {
            const delay = attempt * 200;

            this.logger.warn(
              `Bulk partial errors → retrying ${
                retryActions.length / 2
              } docs (attempt ${attempt})`,
            );

            await this.sleep(delay);

            return this.executeBulk(index, retryActions, attempt + 1);
          }

          /**
           * TODO:
           * Push vào DLQ / Kafka retry topic
           */
          this.logger.error(
            `Bulk permanently failed → ${
              retryActions.length / 2
            } docs moved to DLQ`,
          );
        }

        return;
      }

      this.logger.debug(
        `Bulk OK (${actions.length / 2} docs) for index "${index}"`,
      );
    } catch (error) {
      if (attempt <= 3) {
        const delay = attempt * 200;

        this.logger.warn(
          `Bulk failed on attempt ${attempt} → retrying in ${delay}ms`,
        );

        await this.sleep(delay);

        return this.executeBulk(index, actions, attempt + 1);
      }

      this.logger.error(`Bulk aborted → ${String(error)}`);
    }
  }

  /**
   * Flush all indexes
   */
  async flushAll(): Promise<void> {
    const indexes = Object.keys(this.buffer);

    await Promise.all(indexes.map((index) => this.flushIndex(index)));
  }

  /**
   * Graceful shutdown
   */
  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.flushTimer);

    this.logger.log('App shutting down → flushing all bulks…');

    await this.flushAll();
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
