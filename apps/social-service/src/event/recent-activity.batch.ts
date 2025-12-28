import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import {
  NotificationSample,
  NotificationService,
} from './rabbitmq/notification.service';
import { RecentActivityBufferService } from './recent-activity.buffer.service';

import pLimit from 'p-limit';
import { UserClientService } from 'src/client/user/user-client.service';
import { NotiTargetType } from '@repo/dtos';

@Injectable()
export class RecentActivityBatch {
  private readonly logger = new Logger(RecentActivityBatch.name);

  constructor(
    private readonly buffer: RecentActivityBufferService,
    private readonly userClient: UserClientService,
    private readonly notificationService: NotificationService,
  ) {
    this.logger.log('🚀 RecentActivityBatch initialized');
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async flushRecentActivities() {
    this.logger.log('⏳ Starting flushRecentActivities job...');
    const activities = await this.buffer.snapshotAndGetAll();
    const count = Object.keys(activities).length;
    if (count === 0) return;

    this.logger.log(`🚀 Flushing ${count} recent activities...`);

    const limit = pLimit(20);

    const tasks = Object.keys(activities).map((key) =>
      limit(async () => {
        const activity = activities[key];
        const { actorId, targetId, type } = activity;

        try {
          const actor = await this.userClient.getUserInfo(actorId);
          if (!actor) return;

          const message: NotificationSample = {
            id: randomUUID(),
            eventType: type,
            payload: {
              targetType: NotiTargetType.FRIEND,
              actorName:
                `${actor.lastName ?? ''} ${actor.firstName ?? ''}`.trim(),
              actorAvatar: actor.avatarUrl,
              targetId,
              content: '',
            },
          };

          await this.notificationService.sendNotification(message);
          this.logger.debug(`✅ Sent ${type} :${targetId}`);
        } catch (err) {
          this.logger.error(
            `❌ Failed ${type}:${targetId}:  ${err?.message || err}`,
          );
        }
      }),
    );

    await Promise.allSettled(tasks);
    await this.buffer.clearProcessingSnapshot();

    this.logger.log(`✅ Done flushing ${count} activities`);
  }
}
