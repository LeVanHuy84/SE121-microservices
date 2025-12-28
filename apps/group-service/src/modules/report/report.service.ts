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
  NotiOutboxPayload,
  NotiTargetType,
  PageResponse,
  ReportStatus,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { GroupReport } from 'src/entities/group-report.entity';
import { Group } from 'src/entities/group.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { Between, DataSource, EntityManager, Repository } from 'typeorm';
import { UserClientService } from '../client/user/user-client.service';

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
    private readonly userClient: UserClientService,
  ) {}
  private readonly VN_OFFSET_HOURS = 7;

  async getDashboard(
    filter: DashboardQueryDTO,
  ): Promise<{ totalGroups: number; pendingReports: number }> {
    // ===== TODAY (VN)
    const todayVN = new Date();
    todayVN.setHours(0, 0, 0, 0);

    // ===== NORMALIZE DATE (VN → UTC)
    let fromDate = this.vnDateToUtcStart(filter.from);
    let toDate = this.vnDateToUtcEnd(filter.to);

    // default = 7 ngày gần nhất (VN)
    if (!toDate) {
      toDate = this.vnDateToUtcEnd(todayVN)!;
    }

    if (!fromDate) {
      const d = new Date(todayVN);
      d.setDate(d.getDate() - 6);
      fromDate = this.vnDateToUtcStart(d)!;
    }

    // ===== TOTAL GROUPS
    const totalGroups = await this.groupRepo.count({
      where: {
        status: GroupStatus.ACTIVE,
        createdAt: Between(fromDate, toDate),
      },
    });

    // ===== PENDING REPORTS (ALL TIME)
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
        throw new RpcException({
          statusCode: 409,
          message: 'You have already reported this group.',
        });
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
    const { groupId, cursor, status, limit, sortBy, order } = filter;

    const queryBuilder =
      this.groupReportRepository.createQueryBuilder('report');

    if (groupId) {
      queryBuilder.where('report.groupId = :groupId', { groupId });
    }

    if (status) {
      queryBuilder.andWhere('report.status = :status', { status });
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
        throw new RpcException({
          statusCode: 404,
          message: 'Group not found!',
        });
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
        throw new RpcException({
          statusCode: 404,
          message: 'No pending reports to ignore',
        });
      }

      // 3. Reset report counter
      group.reports = 0;
      await manager.save(group);

      const actor = await this.userClient.getUserInfo(actorId);
      const actorName = actor?.firstName + ' ' + actor?.lastName;

      // 4. Logging outbox
      const loggingOutbox = this.outboxRepo.create({
        topic: EventTopic.LOGGING,
        destination: EventDestination.KAFKA,
        eventType: LogType.GROUP_LOG,
        payload: {
          actorId,
          targetId: groupId,
          action: 'IGNORE_GROUP_REPORTS',
          detail: `Kiểm duyệt viên "${actorName}" đã bỏ qua báo cáo của nhóm ${group.name}`,
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
        throw new RpcException({
          statusCode: 404,
          message: 'Group not found!',
        });
      }

      if (group.status === GroupStatus.BANNED) {
        throw new RpcException({
          statusCode: 409,
          message: 'Group has been banned!',
        });
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

      const actor = await this.userClient.getUserInfo(actorId);
      const actorName = actor?.firstName + ' ' + actor?.lastName;

      // 5. Logging outbox
      const loggingOutbox = this.outboxRepo.create({
        topic: EventTopic.LOGGING,
        destination: EventDestination.KAFKA,
        eventType: LogType.GROUP_LOG,
        payload: {
          actorId,
          targetId: groupId,
          action: 'BAN_GROUP',
          detail: `Nhóm "${group.name}" đã bị cấm bởi "${actorName}"`,
          timestamp: new Date(),
        },
      });

      const notiPayload: NotiOutboxPayload = {
        targetId: groupId,
        targetType: NotiTargetType.GROUP,
        content: 'đã bị ban bởi quản trị hệ thống',
        receivers: [group.owner.id],
      };

      const notiOutbox = manager.create(OutboxEvent, {
        destination: EventDestination.RABBITMQ,
        topic: 'notification',
        eventType: 'group_noti',
        payload: notiPayload,
      });

      await manager.save(loggingOutbox);
      await manager.save(notiOutbox);

      return true;
    });
  }

  async unbanGroup(groupId: string, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const group = await manager.findOne(Group, {
        where: { id: groupId },
      });

      if (!group) {
        throw new RpcException({
          statusCode: 404,
          message: 'Group not found',
        });
      }

      if (group.status !== GroupStatus.BANNED) {
        throw new RpcException({
          statusCode: 409,
          message: 'The group has not been banned.',
        });
      }

      // 1. Update state
      group.status = GroupStatus.ACTIVE;
      await manager.save(group);

      const actor = await this.userClient.getUserInfo(actorId);
      const actorName = actor?.firstName + ' ' + actor?.lastName;

      // 2. Logging outbox
      const loggingOutbox = manager.create(OutboxEvent, {
        topic: EventTopic.LOGGING,
        destination: EventDestination.KAFKA,
        eventType: LogType.GROUP_LOG,
        payload: {
          actorId,
          targetId: groupId,
          action: 'UNBAN_GROUP',
          detail: `Nhóm "${group.name}" đã được khôi phục bởi "${actorName}"`,
          timestamp: new Date(),
        },
      });

      // 3. Group domain event (UNBANNED)
      const payload: InferGroupPayload<GroupEventType.CREATED> = {
        groupId: group.id,
        name: group.name,
        description: group.description,
        privacy: group.privacy,
        avatarUrl: group.avatar.url,
        members: group.members,
        createdAt: group.createdAt,
      };
      await this.createGroupOutboxEvent(GroupEventType.CREATED, payload);

      const notiPayload: NotiOutboxPayload = {
        targetId: groupId,
        targetType: NotiTargetType.GROUP,
        content: 'đã được khôi phục bởi quản trị hệ thống',
        receivers: [group.owner.id],
      };

      // 4. Notification outbox
      const notiOutbox = manager.create(OutboxEvent, {
        destination: EventDestination.RABBITMQ,
        topic: 'notification',
        eventType: 'group_noti',
        payload: notiPayload,
      });

      await manager.save([loggingOutbox, notiOutbox]);

      return true;
    });
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
      data.map((g) => {
        const dto = new AdminGroupDTO();
        dto.id = g.id;
        return dto;
      }),
      total,
      page,
      limit,
    );
  }

  async getReportChart(filter: DashboardQueryDTO) {
    // ===============================
    // 1. NORMALIZE FILTER (VN → UTC)
    // ===============================

    const todayVN = new Date();
    todayVN.setHours(0, 0, 0, 0);

    let fromDate = this.vnDateToUtcStart(filter.from);
    let toDate = this.vnDateToUtcEnd(filter.to);

    // default: 7 ngày gần nhất (VN)
    if (!toDate) {
      toDate = this.vnDateToUtcEnd(todayVN)!;
    }

    if (!fromDate) {
      const d = new Date(todayVN);
      d.setDate(d.getDate() - 6);
      fromDate = this.vnDateToUtcStart(d)!;
    }

    // ===============================
    // 2. LIMIT RANGE (MAX 30 DAYS)
    // ===============================

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

    // ===============================
    // 3. BUILD DATE KEYS (VN)
    // ===============================

    const buildDateKeys = (from: Date, to: Date) => {
      const keys: string[] = [];

      const startVN = new Date(
        from.getTime() + this.VN_OFFSET_HOURS * 3600_000,
      );
      const endVN = new Date(to.getTime() + this.VN_OFFSET_HOURS * 3600_000);

      const cursor = new Date(startVN);
      cursor.setHours(0, 0, 0, 0);

      while (cursor <= endVN) {
        keys.push(cursor.toISOString().slice(0, 10));
        cursor.setDate(cursor.getDate() + 1);
      }

      return keys;
    };

    const dateKeys = buildDateKeys(fromDate, toDate);

    // ===============================
    // 4. INIT MAP
    // ===============================

    const map = new Map<
      string,
      {
        date: string;
        pendingCount: number;
        resolvedCount: number;
        rejectedCount: number;
      }
    >();

    dateKeys.forEach((k) =>
      map.set(k, {
        date: k,
        pendingCount: 0,
        resolvedCount: 0,
        rejectedCount: 0,
      }),
    );

    // ===============================
    // 5. QUERY REPORTS (GROUP BY NGÀY VN)
    // ===============================

    const reports = await this.dataSource
      .getRepository(GroupReport)
      .createQueryBuilder('r')
      .select(
        `to_char(timezone('Asia/Ho_Chi_Minh', r.created_at), 'YYYY-MM-DD')`,
        'date',
      )
      .addSelect('r.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('r.created_at BETWEEN :from AND :to', {
        from: fromDate,
        to: toDate,
      })
      .groupBy('date')
      .addGroupBy('r.status')
      .getRawMany();

    // ===============================
    // 6. MERGE DATA
    // ===============================

    reports.forEach((r) => {
      const item = map.get(r.date);
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
