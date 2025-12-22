import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AuditLogQuery,
  AuditLogResponseDTO,
  CursorPageResponse,
  SortOrder,
} from '@repo/dtos';
import { Model } from 'mongoose';
import { AuditLog, AuditLogDocument } from 'src/mongo/schema/audit-log.schema';

@Injectable()
export class LogService {
  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
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
}
