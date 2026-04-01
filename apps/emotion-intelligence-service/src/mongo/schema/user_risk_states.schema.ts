import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { RiskLevel } from '@repo/dtos';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'user_risk_states', timestamps: true })
export class UserRiskState {
  _id?: Types.ObjectId;

  @Prop({ required: true, unique: true, index: true })
  userId: string;

  // level hiện tại
  @Prop({
    required: true,
    enum: RiskLevel,
    default: RiskLevel.NORMAL,
  })
  riskLevel: RiskLevel;

  // score tổng hợp (0–1)
  @Prop({ required: true, default: 0 })
  riskScore: number;

  // số window ổn định ở level hiện tại (anti flicker)
  @Prop({ required: true, default: 0 })
  stableWindows: number;

  // chống spam notify
  @Prop()
  lastNotifiedAt?: Date;

  // lưu snapshot để tính hysteresis
  @Prop({ required: true, default: 0 })
  previousRiskScore: number;

  // lần cuối evaluate
  @Prop()
  lastEvaluatedAt?: Date;
}

export type UserRiskStateDocument = HydratedDocument<UserRiskState>;

export const UserRiskStateSchema = SchemaFactory.createForClass(UserRiskState);

UserRiskStateSchema.index({ userId: 1 }, { unique: true });
