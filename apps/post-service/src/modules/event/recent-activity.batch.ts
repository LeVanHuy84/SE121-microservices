import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RecentActivityBufferService } from './recent-activity.buffer.service';
import {
  NotificationSample,
  NotificationService,
} from './rabbitmq/notification.service';
import { randomUUID } from 'crypto';
import { UserClientService } from '../client/user/user-client.service';
import { DataSource } from 'typeorm';
import { TargetType } from '@repo/dtos';
import { Post } from 'src/entities/post.entity';
import { Share } from 'src/entities/share.entity';
import pLimit from 'p-limit';

@Injectable()
export class RecentActivityBatch {
  private readonly logger = new Logger(RecentActivityBatch.name);

  constructor(
    private readonly buffer: RecentActivityBufferService,
    private readonly userClient: UserClientService,
    private readonly dataSource: DataSource,
    private readonly notificationService: NotificationService
  ) {
    this.logger.log('🚀 RecentActivityBatch initialized');
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async flushRecentActivities() {
    const activities = await this.buffer.snapshotAndGetAll();
    const count = Object.keys(activities).length;
    if (count === 0) return;

    this.logger.log(`🚀 Flushing ${count} recent activities...`);
    const manager = this.dataSource.manager;
    const limit = pLimit(20);

    const tasks = Object.keys(activities).map((key) =>
      limit(async () => {
        const activity = activities[key];
        const { actorId, targetId, targetType, type } = activity;

        try {
          const actor = await this.userClient.getUserInfo(actorId);
          if (!actor) return;

          let target: { userId: string; content?: string } | null = null;
          if (targetType === TargetType.POST) {
            target = await manager.findOne(Post, {
              select: ['userId', 'content'],
              where: { id: targetId },
            });
          } else if (targetType === TargetType.SHARE) {
            target = await manager.findOne(Share, {
              select: ['userId', 'content'],
              where: { id: targetId },
            });
          }
          if (!target) return;

          const message: NotificationSample = {
            id: randomUUID(),
            eventType: type,
            payload: {
              userId: target.userId,
              actorId: actor.id,
              actorName:
                `${actor.lastName ?? ''} ${actor.firstName ?? ''}`.trim(),
              actorAvatar: actor.avatarUrl,
              targetType,
              targetId,
              content: target.content?.slice(0, 100) ?? '',
            },
          };

          await this.notificationService.sendNotification(message);
          this.logger.debug(`✅ Sent ${type} for ${targetType}:${targetId}`);
        } catch (err) {
          this.logger.error(
            `❌ Failed ${type} for ${targetType}:${targetId}: ${err.message}`
          );
        }
      })
    );

    await Promise.allSettled(tasks);
    await this.buffer.clearProcessingSnapshot();

    this.logger.log(`✅ Done flushing ${count} activities`);
  }
}
