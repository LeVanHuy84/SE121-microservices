import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ActivityType } from '@repo/dtos';
import { HydratedDocument, Types } from 'mongoose';

@Schema({
  collection: 'user_activity_logs',
  timestamps: true,
})
export class UserActivityLog {
  _id?: Types.ObjectId;

  @Prop({ required: true, index: true })
  actorId: string;

  @Prop({ required: true, enum: ActivityType, index: true })
  activityType: ActivityType;

  // object being interacted with
  @Prop({ required: true, index: true })
  targetId: string;

  // lightweight preview
  @Prop()
  contentPreview?: string;

  // metadata flexible
  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop({ default: Date.now, index: true })
  createdAt: Date;
}

export type UserActivityLogDocument = HydratedDocument<UserActivityLog>;
export const UserActivityLogSchema =
  SchemaFactory.createForClass(UserActivityLog);
