import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CreateReportDTO,
  EventDestination,
  EventTopic,
  LogType,
  NotiOutboxPayload,
  NotiTargetType,
  PostEventType,
  ReportResponseDTO,
  ReportStatus,
  RootType,
  ShareEventType,
  TargetType,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { CONTENT_TYPE_VN, TARGET_CONFIG } from 'src/constant';
import { CommentStat } from 'src/entities/comment-stat.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { PostStat } from 'src/entities/post-stat.entity';
import { Post } from 'src/entities/post.entity';
import { Report } from 'src/entities/report.entity';
import { ShareStat } from 'src/entities/share-stat.entity';
import { EntityManager, Repository } from 'typeorm';
import { UserClientService } from '../client/user/user-client.service';

@Injectable()
export class ReportService {
  constructor(
    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>,
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,
    @InjectRepository(PostStat)
    private readonly postStatRepo: Repository<PostStat>,
    @InjectRepository(CommentStat)
    private readonly commentStatRepo: Repository<CommentStat>,
    @InjectRepository(ShareStat)
    private readonly shareStatRepo: Repository<ShareStat>,
    private readonly userClient: UserClientService
  ) {}

  async createReport(userId: string, dto: CreateReportDTO) {
    let groupId: string | undefined;

    if (dto.targetType === TargetType.POST) {
      const post = await this.postRepo.findOne({
        where: { id: dto.targetId },
        select: ['id', 'groupId'],
      });
      if (!post) throw new Error('Post not found');
      groupId = post.groupId;
    }

    const report = this.reportRepo.create({
      ...dto,
      reporterId: userId,
      groupId,
    });

    const saved = await this.reportRepo.save(report);

    // 🔥 UPDATE STAT
    await this.increaseReportCount(dto.targetType, dto.targetId);

    return plainToInstance(ReportResponseDTO, saved);
  }

  async resolveTarget(
    targetId: string,
    targetType: TargetType,
    moderatorId: string
  ): Promise<boolean> {
    return this.reportRepo.manager.transaction(async (manager) => {
      const config = this.getTargetConfig(targetType);

      // 1. Resolve only PENDING reports
      await manager
        .createQueryBuilder()
        .update(Report)
        .set({
          status: ReportStatus.RESOLVED,
          resolvedBy: moderatorId,
        })
        .where(
          'targetId = :targetId AND targetType = :targetType AND status = :status',
          {
            targetId,
            targetType,
            status: ReportStatus.PENDING,
          }
        )
        .execute();

      // 2. Get target owner
      const ownerId = await this.getTargetOwner(
        manager,
        config.table,
        targetId
      );

      // 3. Soft delete target (only once)
      const deleteResult = await manager
        .createQueryBuilder()
        .update(config.table)
        .set({ isDeleted: true })
        .where('id = :id AND isDeleted = false', { id: targetId })
        .execute();

      if (!deleteResult.affected) {
        throw new RpcException({
          statusCode: 409,
          message: 'Target already removed',
        });
      }

      // 4. Reset pending report stats
      await manager
        .createQueryBuilder()
        .update(config.statsTable)
        .set({ reports: 0 })
        .where(`${config.statId} = :id`, { id: targetId })
        .execute();

      // 5. Domain outbox
      let domainOutbox: OutboxEvent | null = null;

      switch (targetType) {
        case TargetType.POST:
          domainOutbox = this.outboxRepo.create({
            topic: EventTopic.POST,
            destination: EventDestination.KAFKA,
            eventType: PostEventType.REMOVED,
            payload: { postId: targetId },
          });
          break;

        case TargetType.SHARE:
          domainOutbox = this.outboxRepo.create({
            topic: EventTopic.SHARE,
            destination: EventDestination.KAFKA,
            eventType: ShareEventType.REMOVED,
            payload: { shareId: targetId },
          });
          break;

        case TargetType.COMMENT:
          break;
      }

      // 6. Logging
      const actor = await this.userClient.getUserInfo(moderatorId);
      const actorName =
        `${actor?.firstName ?? ''} ${actor?.lastName ?? ''}`.trim();
      const contentTypeVN = CONTENT_TYPE_VN[targetType];

      const loggingOutbox = this.outboxRepo.create({
        topic: EventTopic.LOGGING,
        destination: EventDestination.KAFKA,
        eventType: LogType.POST_LOG,
        payload: {
          actorId: moderatorId,
          targetId,
          targetType,
          action: 'RESOLVE_AND_REMOVE',
          detail: `Kiểm duyệt viên "${actorName}" đã xử lý và ẩn một ${contentTypeVN}`,
          timestamp: new Date(),
        },
      });

      // 7. Notification
      const notiTarget = await this.createNotiTarget(
        targetId,
        targetType,
        manager
      );
      const notiPayload: NotiOutboxPayload = {
        targetId: notiTarget.targetId,
        targetType: notiTarget.targetType,
        content: 'vi phạm tiêu chuẩn cộng đồng',
        receivers: [ownerId],
      };

      const notiOutbox = manager.create(OutboxEvent, {
        destination: EventDestination.RABBITMQ,
        topic: 'notification',
        eventType: 'resolve_content',
        payload: notiPayload,
      });

      if (domainOutbox) {
        await manager.save(domainOutbox);
      }

      await manager.save([loggingOutbox, notiOutbox]);

      return true;
    });
  }

  async rejectReport(
    targetId: string,
    targetType: TargetType,
    moderatorId: string
  ): Promise<boolean> {
    return this.reportRepo.manager.transaction(async (manager) => {
      const config = this.getTargetConfig(targetType);

      // 1. Reject all PENDING reports
      const reportResult = await manager
        .createQueryBuilder()
        .update(Report)
        .set({
          status: ReportStatus.REJECTED,
          resolvedBy: moderatorId,
        })
        .where(
          'targetId = :targetId AND targetType = :targetType AND status = :status',
          {
            targetId,
            targetType,
            status: ReportStatus.PENDING,
          }
        )
        .execute();

      if (!reportResult.affected) {
        throw new RpcException({
          statusCode: 409,
          message: 'No pending reports to reject',
        });
      }

      // 2. Reset pending report stats
      await manager
        .createQueryBuilder()
        .update(config.statsTable)
        .set({ reports: 0 })
        .where(`${config.statId} = :id`, { id: targetId })
        .execute();

      const actor = await this.userClient.getUserInfo(moderatorId);
      const actorName =
        `${actor?.firstName ?? ''} ${actor?.lastName ?? ''}`.trim();
      const contentTypeVN = CONTENT_TYPE_VN[targetType];

      // 3. Logging
      const loggingOutbox = this.outboxRepo.create({
        topic: EventTopic.LOGGING,
        destination: EventDestination.KAFKA,
        eventType: LogType.POST_LOG,
        payload: {
          actorId: moderatorId,
          targetId,
          targetType,
          action: 'REJECT_REPORT',
          detail: `Kiểm duyệt viên "${actorName}" đã bỏ qua báo cáo 1 ${contentTypeVN}`,
          timestamp: new Date(),
        },
      });

      await manager.save(loggingOutbox);

      return true;
    });
  }

  // ==== Helper methods ====
  private async increaseReportCount(targetType: TargetType, targetId: string) {
    switch (targetType) {
      case TargetType.POST:
        await this.postStatRepo.increment({ postId: targetId }, 'reports', 1);
        break;

      case TargetType.COMMENT:
        await this.commentStatRepo.increment(
          { commentId: targetId },
          'reports',
          1
        );
        break;

      case TargetType.SHARE:
        await this.shareStatRepo.increment({ shareId: targetId }, 'reports', 1);
        break;
    }
  }

  private getTargetConfig(targetType: TargetType) {
    const config = TARGET_CONFIG[targetType];
    if (!config) {
      throw new RpcException({
        statusCode: 400,
        message: 'Invalid targetType',
      });
    }
    return config;
  }

  private async getTargetOwner(
    manager: EntityManager,
    table: string,
    targetId: string
  ): Promise<string> {
    const target = await manager
      .createQueryBuilder()
      .select(['t.id', 't.userId'])
      .from(table, 't')
      .where('t.id = :id', { id: targetId })
      .getRawOne();

    if (!target) {
      throw new RpcException({
        statusCode: 404,
        message: 'Target content not found',
      });
    }

    return target.userId;
  }

  private async createNotiTarget(
    targetId: string,
    targetType: TargetType,
    manager
  ) {
    switch (targetType) {
      case TargetType.POST:
        return {
          targetId,
          targetType: NotiTargetType.POST,
        };
      case TargetType.SHARE:
        return {
          targetId,
          targetType: NotiTargetType.SHARE,
        };
      case TargetType.COMMENT:
        const comment = await manager
          .createQueryBuilder()
          .select(['c.id', 'c.rootType', 'c.rootId'])
          .from('comments', 'c')
          .where('c.id = :id', { id: targetId })
          .getRawOne();

        const type =
          comment.rootType === RootType.POST
            ? NotiTargetType.POST
            : NotiTargetType.SHARE;
        return {
          targetId: comment.rootId,
          targetType: type,
        };
    }
  }
}
