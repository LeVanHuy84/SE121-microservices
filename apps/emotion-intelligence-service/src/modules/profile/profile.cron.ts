import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ProfileProcessor } from './profile.processor';

@Injectable()
export class ProfileCron {
  private readonly logger = new Logger(ProfileCron.name);

  constructor(private readonly profileProcessor: ProfileProcessor) {}

  /**
   * Daily Maintenance Cron Job (Chạy 1 lần/ngày lúc 00:00 AM UTC):
   * Quét suy giảm điểm tiêu cực (Decay Sweep) cho các User "im lặng"
   * (không có hoạt động bài đăng mới trong 7 ngày) giúp điểm rủi ro phục hồi tự nhiên về NORMAL.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: 'UTC' })
  async runDailyDecaySweep(): Promise<void> {
    const startedAt = new Date();
    this.logger.log('Starting daily maintenance decay sweep for inactive users...');

    try {
      const result = await this.profileProcessor.processDailyDecaySweep();
      this.logger.log(
        `Daily maintenance decay sweep completed successfully. Processed ${result.processedCount} inactive profiles.`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to execute daily decay sweep',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

