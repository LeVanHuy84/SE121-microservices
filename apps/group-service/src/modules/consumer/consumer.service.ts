import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EventDestination,
  GroupEventLog,
  NotiOutboxPayload,
  NotiTargetType,
  PostGroupEventPayload,
} from '@repo/dtos';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { In, Repository, EntityManager } from 'typeorm';
import { GroupMember } from 'src/entities/group-member.entity';
import { GroupLogService } from '../group-log/group-log.service';

@Injectable()
export class ConsumerService {
  private readonly logger = new Logger(ConsumerService.name);

  constructor(
    private readonly groupLogService: GroupLogService,
    @InjectRepository(GroupMember)
    private readonly memberRepo: Repository<GroupMember>,
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
  ) {}

  private getMemberRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(GroupMember) : this.memberRepo;
  }

  private getOutboxRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(OutboxEvent) : this.outboxRepo;
  }

  async handlePending(payload: PostGroupEventPayload, manager?: EntityManager) {
    try {
      const repo = this.getMemberRepo(manager);

      const admins = await repo.find({
        where: { groupId: payload.groupId, role: In(['ADMIN', 'MODERATOR']) },
        select: ['userId'],
      });

      const notificationPayload: NotiOutboxPayload = {
        targetId: payload.groupId,
        targetType: NotiTargetType.GROUP,
        content: `Có bài viết cần duyệt "${payload.content.slice(0, 50)}..."`,
        receivers: admins.map((admin) => admin.userId),
      };

      await this.saveOutboxEvent(notificationPayload, manager);
    } catch (err) {
      this.logger.error('handlePending failed', err as any);
      throw err;
    }
  }

  async handleApproved(
    payload: PostGroupEventPayload,
    manager?: EntityManager,
  ) {
    try {
      await this.groupLogService.log(manager!, {
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

      await this.saveOutboxEvent(notificationPayload, manager);
    } catch (err) {
      this.logger.error('handleApproved failed', err as any);
      throw err;
    }
  }

  async handleRejected(
    payload: PostGroupEventPayload,
    manager?: EntityManager,
  ) {
    try {
      await this.groupLogService.log(manager!, {
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

      await this.saveOutboxEvent(notificationPayload, manager);
    } catch (err) {
      this.logger.error('handleRejected failed', err as any);
      throw err;
    }
  }

  private async saveOutboxEvent(payload: any, manager?: EntityManager) {
    const repo = this.getOutboxRepo(manager);

    const outbox = repo.create({
      topic: 'notifications',
      destination: EventDestination.RABBITMQ,
      eventType: 'group_noti',
      payload,
    });

    await repo.save(outbox);
  }
}
