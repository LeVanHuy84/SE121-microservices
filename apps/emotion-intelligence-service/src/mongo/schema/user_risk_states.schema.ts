import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { RiskLevel, TriggerFlag } from '@repo/dtos';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'user_risk_states', timestamps: true })
export class UserRiskState {
  _id?: Types.ObjectId;

  @Prop({ required: true, unique: true, index: true })
  userId: string;

  // level hiện tại
  @Prop({
    required: true,
    type: String,
    enum: RiskLevel,
    default: RiskLevel.NORMAL,
  })
  riskLevel: RiskLevel;

  // score tổng hợp (0–1) Primary Driver
  @Prop({ required: true, default: 0 })
  riskScore: number;

  // Danh sách cờ định tính nhận diện nguyên nhân
  @Prop({ type: [String], default: [] })
  riskTriggers: TriggerFlag[];

  // Lần cuối phát gợi ý can thiệp (chống spam thông báo)
  @Prop()
  lastInterventionAt?: Date;

  @Prop()
  lastInterventionType?: string;

  // số window ổn định ở level hiện tại (anti flicker)
  @Prop({ required: true, default: 0 })
  stableWindows: number;

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
