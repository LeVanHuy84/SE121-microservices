import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { LogType } from '@repo/dtos';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'audit_logs' })
export class AuditLog {
  _id?: Types.ObjectId;

  @Prop({ required: true, index: true })
  actorId: string;

  @Prop({ required: true })
  targetId: string;

  @Prop({ required: true, enum: LogType })
  logType: LogType;

  @Prop()
  action: string;

  @Prop()
  detail: string;

  @Prop({ default: Date.now })
  createdAt: Date;
}

export type AuditLogDocument = HydratedDocument<AuditLog>;
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
