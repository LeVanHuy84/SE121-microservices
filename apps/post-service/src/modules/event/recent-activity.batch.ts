import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RecentActivityBufferService } from './recent-activity.buffer.service';
import { UserClientService } from '../client/user/user-client.service';
import { DataSource } from 'typeorm';
import {
  CreateNotificationDto,
  NotificationPayload,
  NotiTargetType,
  TargetType,
} from '@repo/dtos';
import { Post } from 'src/entities/post.entity';
import { Share } from 'src/entities/share.entity';
import pLimit from 'p-limit';
import { NotificationService } from '@repo/common';

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

  @Cron('*/15 * * * * *')
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
        const { idempotentKey, actorId, targetId, targetType, type } = activity;

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

          const notiPayload: NotificationPayload = {
            targetId,
            targetType:
              targetType === TargetType.POST
                ? NotiTargetType.POST
                : NotiTargetType.SHARE,
            actorName:
              `${actor.lastName ?? ''} ${actor.firstName ?? ''}`.trim(),
            actorAvatar: actor.avatarUrl,
            content: target.content?.slice(0, 50) ?? '',
          };

          const createNotificationDto: CreateNotificationDto = {
            requestId: idempotentKey,
            userId: target.userId,
            type,
            payload: notiPayload,
            sendAt: new Date(),
            meta: {
              priority: 1,
              maxRetries: 3,
            },
            channels: [],
          };

          await this.notificationService.sendNotification(
            createNotificationDto
            // 'post-service'
          );
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
