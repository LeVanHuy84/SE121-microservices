import { Inject, Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
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
  GroupPrivacy,
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
import {
  and,
  asc,
  between,
  count,
  desc,
  eq,
  gt,
  ilike,
  lt,
  sql,
} from 'drizzle-orm';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import type { DrizzleDB } from 'src/drizzle/types/drizzle.d';
import {
  groupReports,
  groups,
  outboxEvents,
} from 'src/drizzle/schema/schema';
import { UserClientService } from './user-client.service';
import { GroupMapper } from 'src/modules/group/common/mapper/group.mapper';

@Injectable()
export class ReportService {
  private readonly VN_OFFSET_HOURS = 7;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly userClient: UserClientService,
  ) {}

  async getDashboard(
    filter: DashboardQueryDTO,
  ): Promise<{ totalGroups: number; pendingReports: number }> {
    const todayVN = new Date();
    todayVN.setHours(0, 0, 0, 0);

    let fromDate = this.vnDateToUtcStart(filter.from);
    let toDate = this.vnDateToUtcEnd(filter.to);

    if (!toDate) toDate = this.vnDateToUtcEnd(todayVN)!;
    if (!fromDate) {
      const d = new Date(todayVN);
      d.setDate(d.getDate() - 6);
      fromDate = this.vnDateToUtcStart(d)!;
    }

    const [{ count: totalGroups }] = await this.db
      .select({ count: count() })
      .from(groups)
      .where(
        and(
          eq(groups.status, GroupStatus.ACTIVE),
          between(groups.createdAt, fromDate, toDate),
        ),
      );

    const [{ count: pendingReports }] = await this.db
      .select({ count: count() })
      .from(groupReports)
      .where(eq(groupReports.status, ReportStatus.PENDING));

    return {
      totalGroups: Number(totalGroups),
      pendingReports: Number(pendingReports),
    };
  }

  async createReport(
    groupId: string,
    reporterId: string,
    createGroupReport: CreateGroupReportDTO,
  ) {
    const { reason } = createGroupReport;

    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(groupReports)
        .where(
          and(
            eq(groupReports.reporterId, reporterId),
            eq(groupReports.groupId, groupId),
          ),
        )
        .limit(1);

      if (existing) {
        throw new RpcException({
          statusCode: 409,
          message: 'You have already reported this group.',
        });
      }

      const [report] = await tx
        .insert(groupReports)
        .values({ groupId, reporterId, reason })
        .returning();

      await tx
        .update(groups)
        .set({ reports: sql`reports + 1` })
        .where(eq(groups.id, groupId));

      return report;
    });
  }

  async getReports(
    filter: GroupReportQuery,
  ): Promise<CursorPageResponse<GroupReportResposeDTO>> {
    const { groupId, cursor, status, limit, sortBy, order } = filter;

    const conditions: any[] = [];
    if (groupId) conditions.push(eq(groupReports.groupId, groupId));
    if (status) conditions.push(eq(groupReports.status, status as any));
    if (cursor) {
      conditions.push(
        order === 'ASC'
          ? gt(groupReports[sortBy], cursor)
          : lt(groupReports[sortBy], cursor),
      );
    }

    const orderExpr =
      order === 'ASC' ? asc(groupReports[sortBy]) : desc(groupReports[sortBy]);

    const reports = await this.db
      .select()
      .from(groupReports)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(orderExpr)
      .limit(limit + 1);

    const hasNextPage = reports.length > limit;
    if (hasNextPage) reports.pop();
    const nextCursor = hasNextPage ? reports[reports.length - 1][sortBy] : null;

    return {
      data: plainToInstance(GroupReportResposeDTO, reports),
      nextCursor,
      hasNextPage,
    };
  }

  async getTopReportedGroups(
    topN: number,
  ): Promise<{ groupId: string; reportCount: number }[]> {
    const result = await this.db
      .select({
        groupId: groupReports.groupId,
        reportCount: count(groupReports.id),
      })
      .from(groupReports)
      .groupBy(groupReports.groupId)
      .orderBy(desc(count(groupReports.id)))
      .limit(topN);

    return result.map((r) => ({
      groupId: r.groupId,
      reportCount: Number(r.reportCount),
    }));
  }

  async ignoreGroupReports(groupId: string, actorId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [group] = await tx
        .select()
        .from(groups)
        .where(eq(groups.id, groupId))
        .limit(1);

      if (!group)
        throw new RpcException({ statusCode: 404, message: 'Group not found!' });

      const result = await tx
        .update(groupReports)
        .set({ status: ReportStatus.REJECTED })
        .where(
          and(
            eq(groupReports.groupId, groupId),
            eq(groupReports.status, ReportStatus.PENDING),
          ),
        );

      if (!result.rowCount) {
        throw new RpcException({ statusCode: 404, message: 'No pending reports to ignore' });
      }

      await tx
        .update(groups)
        .set({ reports: 0 })
        .where(eq(groups.id, groupId));

      const actor = await this.userClient.getUserInfo(actorId);
      const actorName = (actor?.firstName ?? '') + ' ' + (actor?.lastName ?? '');

      await tx.insert(outboxEvents).values({
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

      return true;
    });
  }

  async banGroup(groupId: string, actorId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [group] = await tx
        .select()
        .from(groups)
        .where(eq(groups.id, groupId))
        .limit(1);

      if (!group)
        throw new RpcException({ statusCode: 404, message: 'Group not found!' });
      if (group.status === GroupStatus.BANNED)
        throw new RpcException({ statusCode: 409, message: 'Group has been banned!' });

      await tx
        .update(groupReports)
        .set({ status: ReportStatus.RESOLVED })
        .where(
          and(
            eq(groupReports.groupId, groupId),
            eq(groupReports.status, ReportStatus.PENDING),
          ),
        );

      await tx
        .update(groups)
        .set({ status: GroupStatus.BANNED, reports: 0 })
        .where(eq(groups.id, groupId));

      const payload: InferGroupPayload<GroupEventType.REMOVED> = {
        groupId: group.id,
      };
      await this.createGroupOutboxEvent(tx, GroupEventType.REMOVED, payload);

      const actor = await this.userClient.getUserInfo(actorId);
      const actorName = (actor?.firstName ?? '') + ' ' + (actor?.lastName ?? '');

      await tx.insert(outboxEvents).values([
        {
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
        },
        {
          destination: EventDestination.RABBITMQ,
          topic: 'notification',
          eventType: 'group_noti',
          payload: {
            targetId: groupId,
            targetType: NotiTargetType.GROUP,
            content: 'đã bị ban bởi quản trị hệ thống',
            receivers: [group.owner?.id],
          } as NotiOutboxPayload,
        },
      ]);

      return true;
    });
  }

  async unbanGroup(groupId: string, actorId: string) {
    return this.db.transaction(async (tx) => {
      const [group] = await tx
        .select()
        .from(groups)
        .where(eq(groups.id, groupId))
        .limit(1);

      if (!group)
        throw new RpcException({ statusCode: 404, message: 'Group not found' });
      if (group.status !== GroupStatus.BANNED)
        throw new RpcException({ statusCode: 409, message: 'The group has not been banned.' });

      await tx
        .update(groups)
        .set({ status: GroupStatus.ACTIVE })
        .where(eq(groups.id, groupId));

      const actor = await this.userClient.getUserInfo(actorId);
      const actorName = (actor?.firstName ?? '') + ' ' + (actor?.lastName ?? '');

      const payload: InferGroupPayload<GroupEventType.CREATED> = {
        groupId: group.id,
        name: group.name,
        description: group.description ?? undefined,
        privacy: group.privacy as GroupPrivacy,
        avatarUrl: (group.avatar as any)?.url,
        members: group.members,
        createdAt: group.createdAt,
      };
      await this.createGroupOutboxEvent(tx, GroupEventType.CREATED, payload);

      await tx.insert(outboxEvents).values([
        {
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
        },
        {
          destination: EventDestination.RABBITMQ,
          topic: 'notification',
          eventType: 'group_noti',
          payload: {
            targetId: groupId,
            targetType: NotiTargetType.GROUP,
            content: 'đã được khôi phục bởi quản trị hệ thống',
            receivers: [group.owner?.id],
          } as NotiOutboxPayload,
        },
      ]);

      return true;
    });
  }

  async getGroupByAdmin(filter: AdminGroupQuery): Promise<PageResponse<AdminGroupDTO>> {
    const { name, status, memberRange, page, limit } = filter;
    const conditions: any[] = [];

    if (name) conditions.push(ilike(groups.name, `%${name}%`));
    if (status) conditions.push(eq(groups.status, status as any));

    if (memberRange) {
      switch (memberRange) {
        case GroupMemberRange.LT_100:
          conditions.push(lt(groups.members, 100));
          break;
        case GroupMemberRange.BETWEEN_100_1000:
          conditions.push(between(groups.members, 100, 1000));
          break;
        case GroupMemberRange.GT_1000:
          conditions.push(gt(groups.members, 1000));
          break;
      }
    }

    const skip = (page - 1) * limit;

    const [data, [{ count: total }]] = await Promise.all([
      this.db
        .select()
        .from(groups)
        .where(conditions.length ? and(...conditions) : undefined)
        .limit(limit)
        .offset(skip),
      this.db
        .select({ count: count() })
        .from(groups)
        .where(conditions.length ? and(...conditions) : undefined),
    ]);

    return new PageResponse(
      data.map((g) => GroupMapper.toAdminGroupDTO(g as any)),
      Number(total),
      page,
      limit,
    );
  }

  async getReportChart(filter: DashboardQueryDTO) {
    const todayVN = new Date();
    todayVN.setHours(0, 0, 0, 0);

    let fromDate = this.vnDateToUtcStart(filter.from);
    let toDate = this.vnDateToUtcEnd(filter.to);

    if (!toDate) toDate = this.vnDateToUtcEnd(todayVN)!;
    if (!fromDate) {
      const d = new Date(todayVN);
      d.setDate(d.getDate() - 6);
      fromDate = this.vnDateToUtcStart(d)!;
    }

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

    const buildDateKeys = (from: Date, to: Date) => {
      const keys: string[] = [];
      const startVN = new Date(from.getTime() + this.VN_OFFSET_HOURS * 3600_000);
      const endVN = new Date(to.getTime() + this.VN_OFFSET_HOURS * 3600_000);
      const cur = new Date(startVN);
      cur.setHours(0, 0, 0, 0);
      while (cur <= endVN) {
        keys.push(cur.toISOString().slice(0, 10));
        cur.setDate(cur.getDate() + 1);
      }
      return keys;
    };

    const dateKeys = buildDateKeys(fromDate, toDate);
    const map = new Map<string, { date: string; pendingCount: number; resolvedCount: number; rejectedCount: number }>();
    dateKeys.forEach((k) => map.set(k, { date: k, pendingCount: 0, resolvedCount: 0, rejectedCount: 0 }));

    const reports = await this.db.execute<{
      date: string;
      status: string;
      count: string;
    }>(
      sql`
        SELECT
          to_char(timezone('Asia/Ho_Chi_Minh', ${groupReports.createdAt}), 'YYYY-MM-DD') AS date,
          ${groupReports.status} AS status,
          COUNT(*) AS count
        FROM ${groupReports}
        WHERE ${groupReports.createdAt} BETWEEN ${fromDate} AND ${toDate}
        GROUP BY date, ${groupReports.status}
      `,
    );

    for (const r of reports.rows) {
      const item = map.get(r.date);
      if (!item) continue;
      const cnt = Number(r.count);
      if (r.status === ReportStatus.PENDING) item.pendingCount = cnt;
      else if (r.status === ReportStatus.RESOLVED) item.resolvedCount = cnt;
      else if (r.status === ReportStatus.REJECTED) item.rejectedCount = cnt;
    }

    return Array.from(map.values());
  }

  // ===== HELPER =====
  private async createGroupOutboxEvent(
    tx: any,
    eventType: GroupEventType,
    payload: any,
  ) {
    await tx.insert(outboxEvents).values({
      destination: EventDestination.KAFKA,
      topic: EventTopic.GROUP_CRUD,
      eventType,
      payload,
    });
  }

  private normalizeToVNDate(value: string | Date): { y: number; m: number; d: number } {
    let vnDate: Date;
    if (value instanceof Date) {
      vnDate = new Date(value);
    } else if (String(value).includes('T')) {
      vnDate = new Date(value);
    } else {
      const [y, m, d] = String(value).split('-').map(Number);
      return { y, m, d };
    }
    vnDate = new Date(vnDate.getTime() + this.VN_OFFSET_HOURS * 60 * 60 * 1000);
    return { y: vnDate.getFullYear(), m: vnDate.getMonth() + 1, d: vnDate.getDate() };
  }

  private vnDateToUtcStart(value?: Date | string): Date | undefined {
    if (!value) return undefined;
    const { y, m, d } = this.normalizeToVNDate(value);
    return new Date(Date.UTC(y, m - 1, d, -this.VN_OFFSET_HOURS, 0, 0, 0));
  }

  private vnDateToUtcEnd(value?: Date | string): Date | undefined {
    if (!value) return undefined;
    const { y, m, d } = this.normalizeToVNDate(value);
    return new Date(Date.UTC(y, m - 1, d, 23 - this.VN_OFFSET_HOURS, 59, 59, 999));
  }
}
