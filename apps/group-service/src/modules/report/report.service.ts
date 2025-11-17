import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CreateGroupReportDTO,
  CursorPageResponse,
  GroupReportQuery,
  GroupReportResposeDTO,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { GroupReport } from 'src/entities/group-report.entity';
import { DataSource, Repository } from 'typeorm';

@Injectable()
export class ReportService {
  constructor(
    @InjectRepository(GroupReport)
    private readonly groupReportRepository: Repository<GroupReport>,
    private readonly dataSource: DataSource,
  ) {}

  async createReport(
    groupId: string,
    reporterId: string,
    createGroupReport: CreateGroupReportDTO,
  ): Promise<GroupReport> {
    const { reason } = createGroupReport;
    return this.dataSource.transaction(async (manager) => {
      const existing = await this.groupReportRepository.findOne({
        where: { reporterId, groupId },
      });

      if (existing) {
        throw new RpcException('You have already reported this group.');
      }
      const report = manager.create(GroupReport, {
        groupId,
        reporterId,
        reason,
      });
      await manager.save(report);
      await manager
        .createQueryBuilder()
        .update('groups')
        .set({ reports: () => '"reports" + 1' })
        .where('id = :groupId', { groupId })
        .execute();
      return report;
    });
  }

  async getReports(
    filter: GroupReportQuery,
  ): Promise<CursorPageResponse<GroupReportResposeDTO>> {
    const { groupId, cursor, limit, sortBy, order } = filter;

    const queryBuilder =
      this.groupReportRepository.createQueryBuilder('report');

    if (groupId) {
      queryBuilder.where('report.groupId = :groupId', { groupId });
    }

    if (cursor) {
      const operator = order === 'ASC' ? '>' : '<';
      queryBuilder.andWhere(`report.${sortBy} ${operator} :cursor`, { cursor });
    }

    queryBuilder.orderBy(`report.${sortBy}`, order).take(limit + 1);

    const reports = await queryBuilder.getMany();

    // Kiểm tra trang tiếp theo
    const hasNextPage = reports.length > limit;
    if (hasNextPage) reports.pop();

    const nextCursor = hasNextPage ? reports[reports.length - 1][sortBy] : null;

    return {
      data: plainToInstance(GroupReportResposeDTO, reports),
      nextCursor,
      hasNextPage,
    };
  }

  // Get top group reports count
  async getTopReportedGroups(
    topN: number,
  ): Promise<{ groupId: string; reportCount: number }[]> {
    const result = await this.groupReportRepository
      .createQueryBuilder('report')
      .select('report.groupId', 'groupId')
      .addSelect('COUNT(report.id)', 'reportCount')
      .groupBy('report.groupId')
      .orderBy('reportCount', 'DESC')
      .limit(topN)
      .getRawMany();
    return result;
  }
}
