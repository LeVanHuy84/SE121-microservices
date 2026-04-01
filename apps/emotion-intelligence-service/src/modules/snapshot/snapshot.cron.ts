import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { SnapshotProcessor } from './snapshot.processor';
import { SnapshotRepository } from './snapshot.repository';

const SNAPSHOT_LAST_RUN_AT_KEY = 'emotion:snapshot:last_run_at';

@Injectable()
export class SnapshotCron {
  private readonly logger = new Logger(SnapshotCron.name);
  private readonly batchSize: number;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly snapshotProcessor: SnapshotProcessor,
    private readonly snapshotRepository: SnapshotRepository,
  ) {
    const configuredBatch = Number(process.env.SNAPSHOT_BATCH_SIZE ?? 100);
    this.batchSize = Number.isFinite(configuredBatch)
      ? Math.min(200, Math.max(50, configuredBatch))
      : 100;
  }

  // @Cron('5 * * * *', { timeZone: 'UTC' })
  @Cron('44 20 * * *', {
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async runPeriodicAggregation(): Promise<void> {
    const startedAt = new Date();
    const fallbackSince = new Date(startedAt.getTime() - 25 * 60 * 60 * 1000);
    const lastRunRaw = await this.redis.get(SNAPSHOT_LAST_RUN_AT_KEY);
    const since = lastRunRaw ? new Date(lastRunRaw) : fallbackSince;

    const candidateUsers =
      await this.snapshotRepository.getUsersWithAggregatesBetween(
        since,
        startedAt,
      );

    if (candidateUsers.length === 0) {
      await this.redis.set(SNAPSHOT_LAST_RUN_AT_KEY, startedAt.toISOString());
      this.logger.log('No new analytics events for snapshot aggregation');
      return;
    }

    let processed = 0;
    let errors = 0;

    this.logger.log(
      `Starting periodic snapshot aggregation users=${candidateUsers.length}, batchSize=${this.batchSize}`,
    );

    for (let i = 0; i < candidateUsers.length; i += this.batchSize) {
      const batch = candidateUsers.slice(i, i + this.batchSize);

      for (const userId of batch) {
        try {
          const snapshotResult =
            await this.snapshotProcessor.recomputeUserSnapshots(
              userId,
              startedAt,
            );

          if (snapshotResult.success) {
            processed += 1;
          } else {
            errors += 1;
          }
        } catch (error) {
          errors += 1;
          this.logger.error(
            `Failed daily processing for user=${userId}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    }

    await this.redis.set(SNAPSHOT_LAST_RUN_AT_KEY, startedAt.toISOString());

    this.logger.log(
      `Periodic snapshot aggregation completed: processed=${processed}, errors=${errors}`,
    );
  }
}
