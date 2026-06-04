import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AuditLogQuery,
  AuditLogResponseDTO,
  CursorPageResponse,
  SortOrder,
  GetUserActivityLogQuery,
  UserActivityLogResponseDTO,
} from '@repo/dtos';
import { Model } from 'mongoose';
import { AuditLog, AuditLogDocument } from 'src/mongo/schema/audit-log.schema';
import {
  UserActivityLog,
  UserActivityLogDocument,
} from 'src/mongo/schema/user-activity.schema';

@Injectable()
export class LogService {
  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
    @InjectModel(UserActivityLog.name)
    private readonly userActivityModel: Model<UserActivityLogDocument>,
  ) {}

  async getAuditLog(
    query: AuditLogQuery,
  ): Promise<CursorPageResponse<AuditLogResponseDTO>> {
    const {
      actorId,
      logType,
      limit = 10,
      cursor,
      sortBy = 'createdAt',
      order = SortOrder.DESC,
    } = query;

    const filter: Record<string, any> = {};

    if (actorId) {
      filter.actorId = actorId;
    }

    if (logType) {
      filter.logType = logType;
    }

    if (cursor) {
      // createdAt là Date, nên cần parse
      const cursorValue = sortBy === 'createdAt' ? new Date(cursor) : cursor;

      filter[sortBy] =
        order === SortOrder.ASC ? { $gt: cursorValue } : { $lt: cursorValue };
    }

    const logs = await this.auditLogModel
      .find(filter)
      .sort({ [sortBy]: order === SortOrder.ASC ? 1 : -1 })
      .limit(limit + 1)
      .lean();

    const hasNextPage = logs.length > limit;
    if (hasNextPage) {
      logs.pop();
    }

    const data: AuditLogResponseDTO[] = logs.map((log) => ({
      id: log._id.toString(),
      actorId: log.actorId,
      targetId: log.targetId,
      logType: log.logType,
      action: log.action,
      detail: log.detail,
      createdAt: log.createdAt,
    }));

    return {
      data,
      hasNextPage,
      nextCursor: hasNextPage ? data[data.length - 1][sortBy] : null,
    };
  }

  async getUserActivityLog(
    actorId: string,
    query: GetUserActivityLogQuery,
  ): Promise<CursorPageResponse<UserActivityLogResponseDTO>> {
    const {
      activityType,
      fromDate,
      toDate,
      limit = 10,
      cursor,
      sortBy = 'createdAt',
      order = SortOrder.DESC,
    } = query;

    const filter: Record<string, any> = {};
    filter.actorId = actorId;

    if (activityType) {
      filter.activityType = activityType;
    }

    if (fromDate) {
      filter.createdAt = { ...filter.createdAt, $gte: fromDate };
    }

    if (toDate) {
      filter.createdAt = { ...filter.createdAt, $lte: toDate };
    }

    if (cursor) {
      const cursorValue = sortBy === 'createdAt' ? new Date(cursor) : cursor;
      filter[sortBy] =
        order === SortOrder.ASC ? { $gt: cursorValue } : { $lt: cursorValue };
    }

    const logs = await this.userActivityModel
      .find(filter)
      .sort({ [sortBy]: order === SortOrder.ASC ? 1 : -1 })
      .limit(limit + 1)
      .lean();

    const hasNextPage = logs.length > limit;
    if (hasNextPage) logs.pop();

    const data: UserActivityLogResponseDTO[] = logs.map((log) => ({
      id: log._id.toString(),
      actorId: log.actorId,
      activityType: log.activityType,
      targetId: log.targetId,
      contentPreview: log.contentPreview,
      metadata: log.metadata,
      createdAt: log.createdAt,
    }));

    return {
      data,
      hasNextPage,
      nextCursor: hasNextPage ? (data[data.length - 1] as any)[sortBy] : null,
    };
  }
}
