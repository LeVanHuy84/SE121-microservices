import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CreateReportDTO,
  CursorPageResponse,
  EventDestination,
  EventTopic,
  PostEventType,
  ReportFilterDTO,
  ReportResponseDTO,
  ReportStatus,
  ShareEventType,
  TargetType,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { Post } from 'src/entities/post.entity';
import { Report } from 'src/entities/report.entity';
import { DataSource, Repository } from 'typeorm';

@Injectable()
export class ReportService {
  constructor(
    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>,
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>
  ) {}

  async createReport(userId: string, createReportDto: CreateReportDTO) {
    let groupId: string | undefined;

    if (createReportDto.targetType === TargetType.POST) {
      const post = await this.postRepo.findOne({
        where: { id: createReportDto.targetId },
        select: ['id', 'groupId'],
      });
      if (!post) throw new Error('Post not found');
      groupId = post.groupId;
    }

    const report = this.reportRepo.create({
      ...createReportDto,
      reporterId: userId,
      groupId,
    });

    const saved = await this.reportRepo.save(report);
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

      if (outbox) {
        await manager.save(outbox);
      }
      return true;
    });
  }

  async rejectReport(reportId: string, moderatorId: string) {
    const result = await this.reportRepo.update(reportId, {
      status: ReportStatus.REJECTED,
      resolvedBy: moderatorId,
    });

    return plainToInstance(ReportResponseDTO, result);
  }

  async getReports(
    filter: ReportFilterDTO
  ): Promise<CursorPageResponse<ReportResponseDTO>> {
    const {
      groupId,
      reporterId,
      targetType,
      targetId,
      status,
      limit = 10,
      cursor,
      order = 'DESC',
      sortBy = 'createdAt',
    } = filter;

    const query = this.reportRepo.createQueryBuilder('report');

    if (groupId) query.andWhere('report.groupId = :groupId', { groupId });
    if (reporterId)
      query.andWhere('report.reporterId = :reporterId', { reporterId });
    if (targetType)
      query.andWhere('report.targetType = :targetType', { targetType });
    if (targetId) query.andWhere('report.targetId = :targetId', { targetId });
    if (status) query.andWhere('report.status = :status', { status });

    if (cursor) {
      const operator = order === 'ASC' ? '>' : '<';
      query.andWhere(`report.${sortBy} ${operator} :cursor`, { cursor });
    }

    query.orderBy(`report.${sortBy}`, order).take(limit + 1);

    const reports = await query.getMany();

    const hasNextPage = reports.length > limit;
    const data = hasNextPage ? reports.slice(0, limit) : reports;

    let nextCursor: string | null = null;
    if (hasNextPage) {
      const lastValue = data[data.length - 1][sortBy];
      nextCursor = lastValue
        ? lastValue instanceof Date
          ? lastValue.toISOString()
          : String(lastValue)
        : null;
    }

    return {
      data: plainToInstance(ReportResponseDTO, data),
      nextCursor,
      hasNextPage,
    };
  }
}
