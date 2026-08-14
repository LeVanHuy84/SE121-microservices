import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { CallEndReason, CallSessionStatus, CallType } from '@repo/dtos';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true })
export class CallSession {
  @Prop({
    type: Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true,
  })
  conversationId: Types.ObjectId;

  @Prop({ required: true, index: true })
  initiatorId: string;

  @Prop({ type: [String], required: true, default: [] })
  participants: string[];

  @Prop({ type: Boolean, default: false, index: true })
  isGroupCall: boolean;

  @Prop({ type: Number, default: null })
  maxParticipants?: number | null;

  @Prop({ type: String, enum: Object.values(CallType), required: true })
  type: CallType;

  @Prop({
    type: String,
    enum: Object.values(CallSessionStatus),
    default: CallSessionStatus.INITIATED,
    index: true,
  })
  status: CallSessionStatus;

  @Prop({ type: Date, default: null })
  startedAt?: Date | null;

  @Prop({ type: Date, default: null })
  endedAt?: Date | null;

  @Prop({ type: String, enum: Object.values(CallEndReason), default: null })
  endReason?: CallEndReason | null;

  @Prop({ type: Date, default: null, index: true })
  ringTimeoutAt?: Date | null;

  @Prop({ type: Date, default: null, index: true })
  reconnectDeadlineAt?: Date | null;

  @Prop({ type: Number, default: 0 })
  syncVersion: number;

  @Prop({ type: Types.ObjectId, ref: 'Message', default: null })
  callMessageId?: Types.ObjectId | null;
}

export type CallSessionDocument = HydratedDocument<CallSession>;

export const CallSessionSchema = SchemaFactory.createForClass(CallSession);

CallSessionSchema.pre<CallSessionDocument>('save', function (next) {
  if (this.isModified()) {
    this.syncVersion = Date.now();
  }
  if (this.participants?.length) {
    this.participants = [...new Set(this.participants)].sort();
  }
  next();
});

CallSessionSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate() as any;
  if (!update) return next();
  update.$set = update.$set ?? {};
  update.$set.syncVersion = Date.now();
  next();
});

CallSessionSchema.index({ conversationId: 1, createdAt: -1 });
CallSessionSchema.index({ participants: 1, createdAt: -1 });
CallSessionSchema.index({ status: 1, ringTimeoutAt: 1 });
CallSessionSchema.index({ status: 1, reconnectDeadlineAt: 1 });
