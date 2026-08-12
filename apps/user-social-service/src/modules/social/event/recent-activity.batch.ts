import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotiTargetType } from '@repo/dtos';
import { createHash } from 'crypto';
import pLimit from 'p-limit';
import { UserService } from '../../user/user.service';
import {
  NotificationSample,
  NotificationService,
} from './rabbitmq/notification.service';
import {
  RecentActivityBufferService,
  type RecentSocialActivity,
} from './recent-activity.buffer.service';

@Injectable()
export class RecentActivityBatch {
  private readonly logger = new Logger(RecentActivityBatch.name);

  constructor(
    private readonly buffer: RecentActivityBufferService,
    private readonly userService: UserService,
    private readonly notificationService: NotificationService,
  ) {
    this.logger.log('RecentActivityBatch initialized');
  }

  private buildNotificationRequestId(activityKey: string): string {
    return createHash('sha256').update(activityKey).digest('hex');
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async flushRecentActivities() {
    this.logger.log('Starting flushRecentActivities job');
    const activities = await this.buffer.snapshotAndGetAll();
    const count = Object.keys(activities).length;
    if (count === 0) {
      return;
    }

    this.logger.log(`Flushing ${count} recent activities`);

    const actorsById = await this.userService.getBaseUsersBatch(
      [
        ...new Set(
          Object.values(activities).map((activity) => activity.actorId),
        ),
      ],
    );
    const limit = pLimit(20);
    const tasks = Object.entries(activities).map(([activityKey, activity]) =>
      limit(async () => {
        const { actorId, targetId, type } = activity;

        try {
          const actor = actorsById[actorId];
          if (!actor) {
            return { status: 'drop' as const, activityKey, activity };
          }

          const message: NotificationSample = {
            id: this.buildNotificationRequestId(activityKey),
            eventType: type,
            userId: targetId,
            payload: {
              targetType: NotiTargetType.USER,
              actorName:
                `${actor.lastName ?? ''} ${actor.firstName ?? ''}`.trim(),
              actorAvatar: actor.avatarUrl,
              targetId: actorId,
              content: '',
            },
          };

          await this.notificationService.sendNotification(message);
          this.logger.debug(`Sent ${type}:${targetId}`);
          return { status: 'sent' as const, activityKey, activity };
        } catch (error) {
          this.logger.error(
            `Failed ${type}:${targetId}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return { status: 'failed' as const, activityKey, activity };
        }
      }),
    );

    const results = await Promise.all(tasks);
    const completedKeys = results
      .filter((result) => result.status === 'sent' || result.status === 'drop')
      .map((result) => result.activityKey);
    const failedActivities = results
      .filter((result) => result.status === 'failed')
      .map((result) => result.activity as RecentSocialActivity);

    await this.buffer.acknowledgeProcessingActivities(completedKeys);
    await this.buffer.requeueProcessingActivities(failedActivities);
    this.logger.log(`Done flushing ${count} activities`);
  }
}
