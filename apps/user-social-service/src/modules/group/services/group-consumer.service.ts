import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  EventDestination,
  GroupEventLog,
  NotiOutboxPayload,
  NotiTargetType,
  PostGroupEventPayload,
} from '@repo/dtos';
import { and, eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import type { DrizzleDB } from 'src/drizzle/types/drizzle.d';
import { groupMembers, outboxEvents } from 'src/drizzle/schema/schema';
import { GroupLogService } from './group-log.service';

@Injectable()
export class ConsumerService {
  private readonly logger = new Logger(ConsumerService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly groupLogService: GroupLogService,
  ) {}

  async handlePending(payload: PostGroupEventPayload, tx?: any) {
    try {
      const dbOrTx = tx ?? this.db;

      const admins = await dbOrTx
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, payload.groupId),
            inArray(groupMembers.role, ['ADMIN', 'MODERATOR'] as any[]),
          ),
        );

      const notificationPayload: NotiOutboxPayload = {
        targetId: payload.groupId,
        targetType: NotiTargetType.GROUP,
        content: `Có bài viết cần duyệt "${payload.content.slice(0, 50)}..."`,
        receivers: admins.map((a) => a.userId),
      };

      await this.saveOutboxEvent(dbOrTx, notificationPayload);
    } catch (err) {
      this.logger.error('handlePending failed', err as any);
      throw err;
    }
  }

  async handleApproved(payload: PostGroupEventPayload, tx?: any) {
    try {
      const dbOrTx = tx ?? this.db;

      await this.groupLogService.log(dbOrTx, {
        userId: payload.actorId ?? '',
        groupId: payload.groupId,
        eventType: GroupEventLog.POST_APPROVED,
        content: `Đã duyệt bài viết ${payload.content.slice(0, 50)}...`,
      });

      const notificationPayload: NotiOutboxPayload = {
        targetId: payload.groupId,
        targetType: NotiTargetType.GROUP,
        content: `Bài viết ${payload.content.slice(0, 50)}... đã được duyệt`,
        receivers: [payload.userId],
      };

      await this.saveOutboxEvent(dbOrTx, notificationPayload);
    } catch (err) {
      this.logger.error('handleApproved failed', err as any);
      throw err;
    }
  }

  async handleRejected(payload: PostGroupEventPayload, tx?: any) {
    try {
      const dbOrTx = tx ?? this.db;

      await this.groupLogService.log(dbOrTx, {
        userId: payload.actorId ?? '',
        groupId: payload.groupId,
        eventType: GroupEventLog.POST_REJECTED,
        content: `Đã từ chối bài viết ${payload.content.slice(0, 50)}...`,
      });

      const notificationPayload: NotiOutboxPayload = {
        targetId: payload.groupId,
        targetType: NotiTargetType.GROUP,
        content: `Bài viết ${payload.content.slice(0, 50)}... bị từ chối`,
        receivers: [payload.userId],
      };

      await this.saveOutboxEvent(dbOrTx, notificationPayload);
    } catch (err) {
      this.logger.error('handleRejected failed', err as any);
      throw err;
    }
  }

  private async saveOutboxEvent(dbOrTx: any, payload: any) {
    await dbOrTx.insert(outboxEvents).values({
      topic: 'notifications',
      destination: EventDestination.RABBITMQ,
      eventType: 'group_noti',
      payload,
    });
  }
}
