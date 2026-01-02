import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { LogType } from '@repo/dtos';
import { Model } from 'mongoose';
import { AuditLog, AuditLogDocument } from 'src/mongo/schema/audit-log.schema';

@Injectable()
export class ConsumerService {
  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  async createAuditLog(type: LogType, data: any) {
    const createdLog = new this.auditLogModel({
      actorId: data.actorId,
      targetId: data.targetId,
      logType: type,
      action: data.action,
      detail: data.detail,
      log: data.log,
    });
    return createdLog.save();
  }
}
