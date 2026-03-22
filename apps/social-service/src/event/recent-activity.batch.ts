import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotiTargetType } from '@repo/dtos';
import { randomUUID } from 'crypto';
import pLimit from 'p-limit';
import { UserClientService } from 'src/client/user/user-client.service';
import {
  NotificationSample,
  NotificationService,
} from './rabbitmq/notification.service';
import { RecentActivityBufferService } from './recent-activity.buffer.service';

@Injectable()
export class RecentActivityBatch {
  private readonly logger = new Logger(RecentActivityBatch.name);

  constructor(
    private readonly buffer: RecentActivityBufferService,
    private readonly userClient: UserClientService,
    private readonly notificationService: NotificationService,
  ) {
    this.logger.log('RecentActivityBatch initialized');
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

    const actorsById = await this.userClient.getUsers(
      [...new Set(Object.values(activities).map((activity) => activity.actorId))],
      'base',
    );
    const limit = pLimit(20);
    const tasks = Object.values(activities).map((activity) =>
      limit(async () => {
        const { actorId, targetId, type } = activity;

        try {
          const actor = actorsById[actorId];
          if (!actor) {
            return;
          }

          const message: NotificationSample = {
            id: randomUUID(),
            eventType: type,
            payload: {
              targetType: NotiTargetType.USER,
              actorName:
                `${actor.lastName ?? ''} ${actor.firstName ?? ''}`.trim(),
              actorAvatar: actor.avatarUrl,
              targetId,
              content: '',
            },
          };

          await this.notificationService.sendNotification(message);
          this.logger.debug(`Sent ${type}:${targetId}`);
        } catch (error) {
          this.logger.error(
            `Failed ${type}:${targetId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    );

    await Promise.allSettled(tasks);
    await this.buffer.clearProcessingSnapshot();
    this.logger.log(`Done flushing ${count} activities`);
  }
}
