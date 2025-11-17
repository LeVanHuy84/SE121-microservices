import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EventDestination,
  GroupEventLog,
  PostGroupEventPayload,
  PostGroupEventType,
} from '@repo/dtos';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { In, Repository, DataSource, EntityManager } from 'typeorm';
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
    private readonly dataSource: DataSource, // from 'typeorm'
  ) {}

  // Handler khi tạo bài: không cần transaction (chỉ đọc member + ghi outbox)
  // async handleCreated(payload: PostGroupEventPayload) {
  //   try {
  //     const receivers = await this.memberRepo.find({
  //       where: { groupId: payload.groupId },
  //       select: ['userId'],
  //     });

  //     const notificationPayload = {
  //       requestId: payload.postId,
  //       groupId: payload.groupId,
  //       actorId: payload.userId,
  //       content: payload.content,
  //       receivers: receivers.map((member) => member.userId),
  //     };

  //     await this.saveOutboxEvent(
  //       PostGroupEventType.CREATED,
  //       notificationPayload,
  //     );
  //   } catch (err) {
  //     this.logger.error('handleCreated failed', err as any);
  //     throw err;
  //   }
  // }

  // Handler pending: giống create => không cần transaction nếu chỉ notify admins.
  async handlePending(payload: PostGroupEventPayload) {
    try {
      const admins = await this.memberRepo.find({
        where: { groupId: payload.groupId, role: In(['ADMIN', 'MODERATOR']) },
        select: ['userId'],
      });

      const notificationPayload = {
        groupId: payload.groupId,
        actorId: payload.userId,
        content: payload.content,
        receivers: admins.map((admin) => admin.userId),
      };

      await this.saveOutboxEvent(
        PostGroupEventType.POST_PENDING,
        notificationPayload,
      );
    } catch (err) {
      this.logger.error('handlePending failed', err as any);
      throw err;
    }
  }

  // Handler approved: bạn có thể muốn atomic nếu còn thao tác khác (ví dụ cập nhật post status, log group event)
  async handleApproved(payload: PostGroupEventPayload) {
    return await this.dataSource.transaction(async (manager) => {
      try {
        await this.groupLogService.log(manager, {
          userId: payload.actorId ?? '',
          groupId: payload.groupId,
          eventType: GroupEventLog.POST_APPROVED,
          content: `Post ${payload.postId} approved by ${payload.actorId ?? 'unknown'}`,
        });

        const notificationPayload = {
          groupId: payload.groupId,
          actorId: payload.actorId,
          content: payload.content,
          receivers: [payload.userId],
        };

        // Sử dụng manager để lưu outbox trong cùng transaction
        await this.saveOutboxEvent(
          PostGroupEventType.POST_APPROVED,
          notificationPayload,
          manager,
        );
      } catch (err) {
        this.logger.error('handleApproved transaction failed', err as any);
        throw err;
      }
    });
  }

  async handleRejected(payload: PostGroupEventPayload) {
    // tương tự handleApproved nếu cần atomic; hiện để trống hoặc implement tương tự
    return await this.dataSource.transaction(async (manager) => {
      try {
        await this.groupLogService.log(manager, {
          userId: payload.actorId ?? '',
          groupId: payload.groupId,
          eventType: GroupEventLog.POST_REJECTED,
          content: `Post ${payload.postId} rejected by ${payload.actorId ?? 'unknown'}`,
        });

        const notificationPayload = {
          groupId: payload.groupId,
          actorId: payload.actorId,
          content: payload.content,
          receivers: [payload.userId],
        };
        await this.saveOutboxEvent(
          PostGroupEventType.POST_REJECTED,
          notificationPayload,
          manager,
        );
      } catch (err) {
        this.logger.error('handleRejected transaction failed', err as any);
        throw err;
      }
    });
  }

  /**
   * Lưu Outbox. Nếu manager được truyền vào thì dùng EntityManager để tham gia transaction.
   * Nếu không có manager thì dùng repository bình thường.
   */
  private async saveOutboxEvent(
    eventType: PostGroupEventType,
    payload: any,
    manager?: EntityManager,
  ) {
    const eventData = {
      topic: 'notifications',
      destination: EventDestination.RABBITMQ,
      eventType,
      payload,
    };

    if (manager) {
      const repo = manager.getRepository(OutboxEvent);
      const outbox = repo.create(eventData);
      await repo.save(outbox);
    } else {
      const outbox = this.outboxRepo.create(eventData);
      await this.outboxRepo.save(outbox);
    }
  }
}
