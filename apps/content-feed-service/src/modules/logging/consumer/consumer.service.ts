import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { LogEventPayload, LogType, UserActivityLogPayload } from '@repo/dtos';
import { ClientSession, Model } from 'mongoose';
import { AuditLog, AuditLogDocument } from '../mongo/schema/audit-log.schema';
import {
  UserActivityLog,
  UserActivityLogDocument,
} from '../mongo/schema/user-activity.schema';

@Injectable()
export class ConsumerService {
  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
    @InjectModel(UserActivityLog.name)
    private readonly userActivityModel: Model<UserActivityLogDocument>,
  ) {}

  async createAuditLog(
    type: LogType,
    data: LogEventPayload,
    session?: ClientSession,
  ) {
    return this.auditLogModel.create(
      [
        {
          actorId: data.actorId,
          targetId: data.targetId,
          logType: type,
          action: data.action,
          detail: data.detail,
        },
      ],
      { session },
    );
  }

  async createUserActivity(
    data: UserActivityLogPayload,
    session?: ClientSession,
  ) {
    // For simplicity, we are using the same AuditLog collection to store user activity logs.
    // In a real application, you might want to have a separate collection for user activities.
    return this.userActivityModel.create(
      [
        {
          actorId: data.actorId,
          targetId: data.targetId,
          activityType: data.activityType,
          contentPreview: data.contentPreview,
          metadata: data.metadata,
          createdAt: data.createdAt,
        },
      ],
      { session },
    );
  }
}
