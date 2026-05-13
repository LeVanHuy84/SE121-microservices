import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { PROFILE_DIRTY_USERS_KEY } from 'src/common/constants';
import { ProfileProcessor } from './profile.processor';

@Injectable()
export class ProfileCron {
  private readonly logger = new Logger(ProfileCron.name);
  private readonly batchSize: number;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly profileProcessor: ProfileProcessor,
  ) {
    const configuredBatch = Number(process.env.PROFILE_BATCH_SIZE ?? 50);
    this.batchSize = Number.isFinite(configuredBatch)
      ? Math.min(100, Math.max(50, configuredBatch))
      : 50;
  }

  @Cron('*/30 * * * *', { timeZone: 'UTC' })
  //@Cron('16 * * * *') // Chạy mỗi giờ một lần
  async runProfileIncrementalUpdates(): Promise<void> {
    const startedAt = new Date();
    let cursor = '0';
    let processed = 0;
    let errors = 0;

    this.logger.log(
      `Starting profile incremental update with batchSize=${this.batchSize}`,
    );

    do {
      const [nextCursor, userIds] = await this.redis.sscan(
        PROFILE_DIRTY_USERS_KEY,
        cursor,
        'COUNT',
        String(this.batchSize),
      );
      cursor = nextCursor;

      for (const userId of userIds) {
        try {
          const profileResult = await this.profileProcessor.upsertUserProfile(
            userId,
            startedAt,
          );

          if (profileResult.success) {
            await this.redis.srem(PROFILE_DIRTY_USERS_KEY, userId);
            processed += 1;
          } else {
            errors += 1;
          }
        } catch (error) {
          errors += 1;
          this.logger.error(
            `Failed profile processing for user=${userId}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    } while (cursor !== '0');

    this.logger.log(
      `Profile incremental update completed: processed=${processed}, errors=${errors}`,
    );
  }
}
