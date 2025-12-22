import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  AdminGroupDTO,
  AdminGroupQuery,
  CreateGroupReportDTO,
  CursorPageResponse,
  DashboardQueryDTO,
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
  ReportStatus,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { GroupReport } from 'src/entities/group-report.entity';
import { Group } from 'src/entities/group.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { Between, DataSource, EntityManager, Repository } from 'typeorm';

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
  private readonly VN_OFFSET_HOURS = 7;

  async getDashboard(
    filter: DashboardQueryDTO,
  ): Promise<{ totalGroups: number; pendingReports: number }> {
    const nowVN = new Date(Date.now() + this.VN_OFFSET_HOURS * 60 * 60 * 1000);

    // ===== NORMALIZE DATE (VN → UTC) =====
    let fromDate = this.vnDateToUtcStart(filter.from);
    let toDate = this.vnDateToUtcEnd(filter.to);

    // default = 30 ngày gần nhất (VN)
    if (!toDate) {
      toDate = this.vnDateToUtcEnd(nowVN)!;
    }

    if (!fromDate) {
      const d = new Date(nowVN);
      d.setDate(d.getDate() - 29);
      fromDate = this.vnDateToUtcStart(d)!;
    }

    // ===== BUILD WHERE CONDITION =====
    const groupWhere: any = {
      status: GroupStatus.ACTIVE,
      createdAt: Between(fromDate, toDate),
    };

    // ===== TOTAL GROUPS =====
    const totalGroups = await this.groupRepo.count({
      where: groupWhere,
    });

    // ===== PENDING REPORTS (KHÔNG FILTER TIME) =====
    const pendingReports = await this.groupReportRepository.count({
      where: {
        status: ReportStatus.PENDING,
      },
    });

    return {
      totalGroups,
      pendingReports,
    };
  }

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

  async ignoreGroupReports(groupId: string, actorId: string): Promise<boolean> {
    return await this.groupRepo.manager.transaction(async (manager) => {
      // 1. Get group
      const group = await manager.findOne(Group, {
        where: { id: groupId },
      });

      if (!group) {
        throw new RpcException('Group not found!');
      }

      // 2. Reject all pending reports of group
      const reportResult = await manager
        .createQueryBuilder()
        .update(GroupReport)
        .set({
          status: ReportStatus.REJECTED,
        })
        .where('groupId = :groupId AND status = :status', {
          groupId,
          status: ReportStatus.PENDING,
        })
        .execute();

      if (!reportResult.affected) {
        throw new RpcException('No pending reports to ignore');
      }

      // 3. Reset report counter
      group.reports = 0;
      await manager.save(group);

      // 4. Logging outbox
      const loggingOutbox = this.outboxRepo.create({
        topic: EventTopic.LOGGING,
        destination: EventDestination.KAFKA,
        eventType: LogType.GROUP_LOG,
        payload: {
          actorId,
          targetId: groupId,
          action: 'IGNORE_GROUP_REPORTS',
          message: `Moderator ${actorId} ignored all reports for group ${group.name}`,
          timestamp: new Date(),
        },
      });

      await manager.save(loggingOutbox);

      return true;
    });
  }

  async banGroup(groupId: string, actorId: string): Promise<boolean> {
    return await this.groupRepo.manager.transaction(async (manager) => {
      // 1. Lock & get group
      const group = await manager.findOne(Group, {
        where: { id: groupId },
      });

      if (!group) {
        throw new RpcException('Group not found!');
      }

      if (group.status === GroupStatus.BANNED) {
        throw new RpcException('Group has been banned!');
      }

      // 2. Resolve all pending group reports
      await manager
        .createQueryBuilder()
        .update(GroupReport)
        .set({
          status: ReportStatus.RESOLVED,
        })
        .where('groupId = :groupId AND status = :status', {
          groupId,
          status: ReportStatus.PENDING,
        })
        .execute();

      // 3. Update group status + reset reports
      group.status = GroupStatus.BANNED;
      group.reports = 0;

      await manager.save(group);

      // 4. Emit group domain event
      const payload: InferGroupPayload<GroupEventType.REMOVED> = {
        groupId: group.id,
      };

      await this.createGroupOutboxEvent(
        GroupEventType.REMOVED,
        payload,
        manager, // 👈 nếu method hỗ trợ truyền manager
      );

      // 5. Logging outbox
      const loggingOutbox = this.outboxRepo.create({
        topic: EventTopic.LOGGING,
        destination: EventDestination.KAFKA,
        eventType: LogType.GROUP_LOG,
        payload: {
          actorId,
          targetId: groupId,
          action: 'BAN_GROUP',
          message: `Group ${group.name} has been banned`,
          timestamp: new Date(),
        },
      });

      await manager.save(loggingOutbox);

      return true;
    });
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
      plainToInstance(AdminGroupDTO, data, {
        excludeExtraneousValues: true,
      }),
      total,
      page,
      limit,
    );
  }

  async getReportChart(filter: DashboardQueryDTO) {
    const nowVN = new Date(Date.now() + this.VN_OFFSET_HOURS * 60 * 60 * 1000);

    // ===== NORMALIZE DATE (VN → UTC) =====
    let fromDate = this.vnDateToUtcStart(filter.from);
    let toDate = this.vnDateToUtcEnd(filter.to);

    // default = 7 ngày gần nhất
    if (!toDate) {
      toDate = this.vnDateToUtcEnd(nowVN)!;
    }

    if (!fromDate) {
      const d = new Date(nowVN);
      d.setDate(d.getDate() - 6);
      fromDate = this.vnDateToUtcStart(d)!;
    }

    // ===== LIMIT RANGE =====
    const MAX_DAYS = 30;
    const diffDays =
      Math.floor(
        (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24),
      ) + 1;

    if (diffDays > MAX_DAYS) {
      const d = new Date(toDate);
      d.setDate(d.getDate() - (MAX_DAYS - 1));
      fromDate = this.vnDateToUtcStart(d)!;
    }

    // helper key theo ngày VN
    const toKey = (d: Date) =>
      new Date(d.getTime() + this.VN_OFFSET_HOURS * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

    // ===== REPORTS =====
    const reports = await this.dataSource
      .getRepository(GroupReport)
      .createQueryBuilder('r')
      .select(`DATE(r.created_at)`, 'date')
      .addSelect('r.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('r.created_at BETWEEN :from AND :to', {
        from: fromDate,
        to: toDate,
      })
      .groupBy('date')
      .addGroupBy('r.status')
      .getRawMany();

    // ===== INIT MAP =====
    const map = new Map<
      string,
      {
        date: string;
        pendingCount: number;
        resolvedCount: number;
        rejectedCount: number;
      }
    >();

    const days =
      Math.floor(
        (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24),
      ) + 1;

    for (let i = 0; i < days; i++) {
      const d = new Date(fromDate);
      d.setDate(d.getDate() + i);

      const key = toKey(d);
      map.set(key, {
        date: key,
        pendingCount: 0,
        resolvedCount: 0,
        rejectedCount: 0,
      });
    }

    // ===== MERGE DATA =====
    reports.forEach((r) => {
      const key = toKey(new Date(r.date));
      const item = map.get(key);
      if (!item) return;

      const count = Number(r.count);

      switch (r.status) {
        case ReportStatus.PENDING:
          item.pendingCount = count;
          break;
        case ReportStatus.RESOLVED:
          item.resolvedCount = count;
          break;
        case ReportStatus.REJECTED:
          item.rejectedCount = count;
          break;
      }
    });

    return Array.from(map.values());
  }

  // ===== HELPER =====
  private async createGroupOutboxEvent(
    eventType: GroupEventType,
    payload: any,
    manager?: EntityManager,
  ) {
    const repo = manager ? manager.getRepository(OutboxEvent) : this.outboxRepo;

    const event = repo.create({
      destination: EventDestination.KAFKA,
      topic: EventTopic.GROUP_CRUD,
      eventType,
      payload,
    });

    await repo.save(event);
  }

  private normalizeToVNDate(value: string | Date): {
    y: number;
    m: number;
    d: number;
  } {
    let vnDate: Date;

    if (value instanceof Date) {
      vnDate = new Date(value);
    } else if (value.includes('T')) {
      // ISO string → Date
      vnDate = new Date(value);
    } else {
      // YYYY-MM-DD → coi là VN
      const [y, m, d] = value.split('-').map(Number);
      return { y, m, d };
    }

    // Convert UTC → VN
    vnDate = new Date(vnDate.getTime() + this.VN_OFFSET_HOURS * 60 * 60 * 1000);

    return {
      y: vnDate.getFullYear(),
      m: vnDate.getMonth() + 1,
      d: vnDate.getDate(),
    };
  }

  private vnDateToUtcStart(value?: Date | string): Date | undefined {
    if (!value) return undefined;

    const { y, m, d } = this.normalizeToVNDate(value);

    return new Date(Date.UTC(y, m - 1, d, -this.VN_OFFSET_HOURS, 0, 0, 0));
  }

  private vnDateToUtcEnd(value?: Date | string): Date | undefined {
    if (!value) return undefined;

    const { y, m, d } = this.normalizeToVNDate(value);

    return new Date(
      Date.UTC(y, m - 1, d, 23 - this.VN_OFFSET_HOURS, 59, 59, 999),
    );
  }
}
