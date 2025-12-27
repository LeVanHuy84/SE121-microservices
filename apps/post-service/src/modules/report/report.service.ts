import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CreateReportDTO,
  EventDestination,
  EventTopic,
  LogType,
  PostEventType,
  ReportResponseDTO,
  ReportStatus,
  ShareEventType,
  TargetType,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { TARGET_CONFIG } from 'src/constant';
import { CommentStat } from 'src/entities/comment-stat.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { PostStat } from 'src/entities/post-stat.entity';
import { Post } from 'src/entities/post.entity';
import { Report } from 'src/entities/report.entity';
import { ShareStat } from 'src/entities/share-stat.entity';
import { Repository } from 'typeorm';

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
    private readonly shareStatRepo: Repository<ShareStat>
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
    return await this.reportRepo.manager.transaction(async (manager) => {
      const config = TARGET_CONFIG[targetType];
      if (!config) {
        throw new RpcException({
          statusCode: 400,
          message: 'Invalid targetType',
        });
      }

      // 1. Resolve only PENDING reports
      const reportResult = await manager
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

      // 2. Soft delete target content
      await manager
        .createQueryBuilder()
        .update(config.table)
        .set({ isDeleted: true })
        .where('id = :id', { id: targetId })
        .execute();

      // 3. Reset pending report stats
      await manager
        .createQueryBuilder()
        .update(config.statsTable)
        .set({ reports: 0 })
        .where(`${config.statId} = :id`, { id: targetId })
        .execute();

      // 4. Domain outbox event
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
          // Comments do not emit removed events
          break;
      }

      // 5. Logging outbox
      const loggingOutbox = this.outboxRepo.create({
        topic: EventTopic.LOGGING,
        destination: EventDestination.KAFKA,
        eventType: LogType.POST_LOG,
        payload: {
          actorId: moderatorId,
          targetId,
          targetType,
          action: 'RESOLVE_AND_REMOVE',
          message: `Moderator ${moderatorId} resolved reports and removed ${targetType.toLowerCase()} ${targetId}`,
          timestamp: new Date(),
        },
      });

      if (domainOutbox) {
        await manager.save(domainOutbox);
      }

      await manager.save(loggingOutbox);

      return true;
    });
  }

  async rejectReport(
    targetId: string,
    targetType: TargetType,
    moderatorId: string
  ): Promise<boolean> {
    return await this.reportRepo.manager.transaction(async (manager) => {
      const config = TARGET_CONFIG[targetType];
      if (!config) {
        throw new RpcException({
          statusCode: 400,
          message: 'Invalid targetType',
        });
      }

      // 1. Reject all PENDING reports of target
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

      // 3. Logging outbox
      const loggingOutbox = this.outboxRepo.create({
        topic: EventTopic.LOGGING,
        destination: EventDestination.KAFKA,
        eventType: LogType.POST_LOG,
        payload: {
          actorId: moderatorId,
          targetId,
          targetType,
          action: 'REJECT_REPORT',
          message: `Moderator ${moderatorId} rejected all reports for ${targetType.toLowerCase()} ${targetId}`,
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
}
