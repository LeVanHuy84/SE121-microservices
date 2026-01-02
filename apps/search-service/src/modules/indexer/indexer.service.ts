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

  private buffer: Record<string, any[]> = {};
  private flushing: Record<string, boolean> = {};
  private readonly BULK_LIMIT = 500;

  constructor(@Inject(ELASTIC_CLIENT) private readonly es: Client) {
    // Auto flush 2s một lần để dev test
    setInterval(() => this.flushAll(), 2000);
  }

  /**
   * Thêm action + source vào bulk
   * Mỗi document = 2 entry → [ meta, source ]
   */
  addToBulk(index: string, actionMeta: any, source?: any) {
    if (!this.buffer[index]) this.buffer[index] = [];

    this.logger.debug(`Buffered action for index "${index}"`);

    // Push meta
    this.buffer[index].push(actionMeta);

    // Push source nếu có
    if (source) this.buffer[index].push(source);

    // Nếu vượt hạn mức thì flush
    if (this.buffer[index].length >= this.BULK_LIMIT) {
      this.flushIndex(index);
    }
  }

  /**
   * Flush 1 index
   */
  async flushIndex(index: string) {
    if (this.flushing[index]) return;
    this.flushing[index] = true;

    try {
      const actions = this.buffer[index];

      if (!actions?.length) return;

      // Reset buffer trước khi flush để tránh lost
      this.buffer[index] = [];

      await this.executeBulk(index, actions);
    } finally {
      this.flushing[index] = false;
    }
  }

  /**
   * Gửi bulk tới Elasticsearch (ES9 API = operations)
   */
  private async executeBulk(index: string, actions: any[], attempt = 1) {
    try {
      const res = await this.es.bulk({
        refresh: false,
        operations: actions,
      });

      // Nếu có lỗi trong bulk
      if (res.errors) {
        const retryActions: any[] = [];

        res.items.forEach((item, i) => {
          const actionType = Object.keys(item)[0]; // index | update | delete
          const actionResult = item[actionType];

          if (actionResult.error) {
            // Mỗi doc = 2 phần tử (meta + source)
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
              `Bulk partial errors → retrying ${retryActions.length / 2} docs (attempt ${attempt})`,
            );
            await new Promise((r) => setTimeout(r, delay));

            return this.executeBulk(index, retryActions, attempt + 1);
          }

          this.logger.error(
            `Bulk permanently failed → ${retryActions.length / 2} docs moved to DLQ.`,
          );
        }
      } else {
        this.logger.debug(
          `Bulk OK (${actions.length / 2} docs) for index "${index}"`,
        );
      }
    } catch (err) {
      if (attempt <= 3) {
        const delay = attempt * 200;
        this.logger.warn(
          `Bulk failed on attempt ${attempt} → retrying in ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
        return this.executeBulk(index, actions, attempt + 1);
      }

      this.logger.error(`Bulk aborted → ${err}`);
    }
  }

  /**
   * Flush tất cả index
   */
  async flushAll() {
    for (const index of Object.keys(this.buffer)) {
      await this.flushIndex(index);
    }
  }

  /**
   * Khi app tắt vẫn flush
   */
  async onApplicationShutdown() {
    this.logger.log('App shutting down → flushing all bulks…');
    await this.flushAll();
  }
}
