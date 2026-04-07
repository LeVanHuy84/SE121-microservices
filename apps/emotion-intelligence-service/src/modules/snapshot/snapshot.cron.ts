import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { SnapshotProcessor } from './snapshot.processor';
import { SNAPSHOT_DIRTY_USERS_KEY } from 'src/common/constants';

@Injectable()
export class SnapshotCron {
  private readonly logger = new Logger(SnapshotCron.name);
  private readonly batchSize: number;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly snapshotProcessor: SnapshotProcessor,
  ) {
    const configuredBatch = Number(process.env.SNAPSHOT_BATCH_SIZE ?? 100);
    this.batchSize = Number.isFinite(configuredBatch)
      ? Math.min(200, Math.max(50, configuredBatch))
      : 100;
  }

  @Cron('0 * * * *') // Chạy mỗi giờ một lần
  async runDirtyAggregation(): Promise<void> {
    const users = await this.redis.smembers(SNAPSHOT_DIRTY_USERS_KEY);

    if (users.length === 0) {
      this.logger.log('No dirty users for snapshot');
      return;
    }

    this.logger.log(`Processing ${users.length} dirty users`);

    let processed = 0;
    let errors = 0;

    for (let i = 0; i < users.length; i += this.batchSize) {
      const batch = users.slice(i, i + this.batchSize);

      for (const userId of batch) {
        try {
          const result =
            await this.snapshotProcessor.recomputeUserSnapshots(userId);

          if (result.success) {
            processed++;

            // remove khỏi dirty set
            await this.redis.srem(SNAPSHOT_DIRTY_USERS_KEY, userId);
          } else {
            errors++;
          }
        } catch (error) {
          errors++;
          this.logger.error(
            `Failed snapshot for user=${userId}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    }

    this.logger.log(
      `Dirty snapshot done: processed=${processed}, errors=${errors}`,
    );
  }
}
