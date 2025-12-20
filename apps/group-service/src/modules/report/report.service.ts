import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  AdminGroupDTO,
  AdminGroupQuery,
  CreateGroupReportDTO,
  CursorPageResponse,
  EventDestination,
  EventTopic,
  GroupEventType,
  GroupMemberRange,
  GroupReportQuery,
  GroupReportResposeDTO,
  GroupStatus,
  InferGroupPayload,
  LogType,
  PageResponse,
  SystemRole,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { GroupReport } from 'src/entities/group-report.entity';
import { Group } from 'src/entities/group.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { DataSource, Repository } from 'typeorm';

@Injectable()
export class ReportService {
  constructor(
    @InjectRepository(GroupReport)
    private readonly groupReportRepository: Repository<GroupReport>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
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

  async banGroup(groupId: string, actorId: string) {
    const group = await this.groupRepo.findOne({
      where: { id: groupId },
    });

    if (!group) {
      throw new RpcException('Group not found!');
    }

    if (group.status === GroupStatus.BANNED) {
      throw new RpcException('Group has been banned!');
    }

    group.status = GroupStatus.BANNED;

    const loggingPayload = {
      actorId,
      targetId: groupId,
      action: 'Ban group',
      log: `Group ${group.name} has been banned`,
      timestamp: new Date(),
    };

    const loggingOutbox = this.outboxRepo.create({
      topic: EventTopic.LOGGING,
      destination: EventDestination.KAFKA,
      eventType: LogType.GROUP_LOG,
      payload: loggingPayload,
    });

    const payload: InferGroupPayload<GroupEventType.REMOVED> = {
      groupId: group.id,
    };
    await this.createGroupOutboxEvent(GroupEventType.REMOVED, payload);
    await this.groupRepo.save(group);
    await this.outboxRepo.save(loggingOutbox);

    return true;
  }

  async unbanGroup(groupId: string, actorId: string) {
    const group = await this.groupRepo.findOne({
      where: { id: groupId },
    });

    if (!group) {
      throw new RpcException('Group not found!');
    }

    if (group.status !== GroupStatus.BANNED) {
      throw new RpcException('The group has not been banned.');
    }

    group.status = GroupStatus.ACTIVE;

    const loggingPayload = {
      actorId,
      targetId: groupId,
      action: 'Unban group',
      log: `Group ${group.name} has been unbanned`,
      timestamp: new Date(),
    };

    const loggingOutbox = this.outboxRepo.create({
      topic: EventTopic.LOGGING,
      destination: EventDestination.KAFKA,
      eventType: LogType.GROUP_LOG,
      payload: loggingPayload,
    });

    const payload: InferGroupPayload<GroupEventType.CREATED> = {
      groupId: group.id,
      name: group.name,
      description: group.description,
      privacy: group.privacy,
      avatarUrl: group.avatarUrl,
      members: group.members,
      createdAt: group.createdAt,
    };
    await this.createGroupOutboxEvent(GroupEventType.CREATED, payload);
    await this.groupRepo.save(group);
    await this.outboxRepo.save(loggingOutbox);

    return true;
  }

  async getGroupByAdmin(
    filter: AdminGroupQuery,
  ): Promise<PageResponse<AdminGroupDTO>> {
    const { name, status, memberRange, page, limit } = filter;

    const queryBuilder = this.groupRepo.createQueryBuilder('group');

    if (name) {
      queryBuilder.andWhere('group.name ILIKE :name', {
        name: `%${name}%`,
      });
    }

    if (status) {
      queryBuilder.andWhere('group.status = :status', { status });
    }

    if (memberRange) {
      switch (memberRange) {
        case GroupMemberRange.LT_100:
          queryBuilder.andWhere('group.members < :max', { max: 100 });
          break;

        case GroupMemberRange.BETWEEN_100_1000:
          queryBuilder.andWhere('group.members BETWEEN :min AND :max', {
            min: 100,
            max: 1000,
          });
          break;

        case GroupMemberRange.GT_1000:
          queryBuilder.andWhere('group.members > :min', { min: 1000 });
          break;
      }
    }

    const skip = (page - 1) * limit;

    const [data, total] = await queryBuilder
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return new PageResponse(
      plainToInstance(AdminGroupDTO, data),
      total,
      page,
      limit,
    );
  }

  // ===== HELPER =====
  private async createGroupOutboxEvent(
    eventType: GroupEventType,
    payload: any,
  ) {
    const event = this.outboxRepo.create({
      destination: EventDestination.KAFKA,
      topic: EventTopic.GROUP_CRUD,
      eventType,
      payload: payload,
    });
    await this.outboxRepo.save(event);
  }
}
