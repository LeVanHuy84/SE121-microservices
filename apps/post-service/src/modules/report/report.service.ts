import { Injectable } from '@nestjs/common';
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
      await manager
        .createQueryBuilder()
        .update(Report)
        .set({
          status: ReportStatus.RESOLVED,
          resolvedBy: moderatorId,
        })
        .where('targetId = :targetId AND targetType = :targetType', {
          targetId,
          targetType,
        })
        .execute();

      const tableMap = {
        [TargetType.POST]: 'posts',
        [TargetType.SHARE]: 'shares',
        [TargetType.COMMENT]: 'comments',
      };

      const tableName = tableMap[targetType];
      if (tableName) {
        await manager
          .createQueryBuilder()
          .update(tableName)
          .set({ isDeleted: true })
          .where('id = :id', { id: targetId })
          .execute();
      }

      let outbox: OutboxEvent | null = null;

      switch (targetType) {
        case TargetType.POST:
          outbox = this.outboxRepo.create({
            topic: EventTopic.POST,
            destination: EventDestination.KAFKA,
            eventType: PostEventType.REMOVED,
            payload: { postId: targetId },
          });
          break;

        case TargetType.SHARE:
          outbox = this.outboxRepo.create({
            topic: EventTopic.SHARE,
            destination: EventDestination.KAFKA,
            eventType: ShareEventType.REMOVED,
            payload: { shareId: targetId },
          });
          break;

        case TargetType.COMMENT:
        default:
          break;
      }

      const loggingPayload = {
        actorId: moderatorId,
        targetId,
        action: `Resolve report and remove ${targetType.toLowerCase()}`,
        log: `Moderator ${moderatorId} resolved reports and removed ${targetType.toLowerCase()} ${targetId}`,
        timestamp: new Date(),
      };

      const loggingOutbox = this.outboxRepo.create({
        topic: EventTopic.LOGGING,
        destination: EventDestination.KAFKA,
        eventType: LogType.POST_LOG,
        payload: loggingPayload,
      });

      if (outbox) {
        await manager.save(outbox);
      }
      await manager.save(loggingOutbox);
      return true;
    });
  }

  async rejectReport(reportId: string, moderatorId: string) {
    const result = await this.reportRepo.update(reportId, {
      status: ReportStatus.REJECTED,
      resolvedBy: moderatorId,
    });

    const loggingPayload = {
      actorId: moderatorId,
      reportId,
      action: `Reject report`,
      log: `Moderator ${moderatorId} rejected report ${reportId}`,
      timestamp: new Date(),
    };

    const loggingOutbox = this.outboxRepo.create({
      topic: EventTopic.LOGGING,
      destination: EventDestination.KAFKA,
      eventType: LogType.POST_LOG,
      payload: loggingPayload,
    });

    await this.outboxRepo.save(loggingOutbox);

    return plainToInstance(ReportResponseDTO, result);
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
