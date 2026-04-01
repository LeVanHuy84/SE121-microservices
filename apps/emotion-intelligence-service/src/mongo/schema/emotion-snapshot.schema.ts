import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { EmotionTimeWindow } from '@repo/dtos';

@Schema({ collection: 'user_emotion_snapshots', timestamps: true })
export class UserEmotionSnapshot {
  _id?: Types.ObjectId;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, enum: EmotionTimeWindow, index: true })
  window: EmotionTimeWindow; // 1d, 7d, 30d

  // phân bố cảm xúc
  @Prop({ type: Object, required: true })
  emotionDistribution: Record<string, number>;

  // tỷ lệ tiêu cực
  @Prop({ required: true })
  negativeRatio: number;

  // độ dao động cảm xúc (variance/std)
  @Prop({ required: true })
  emotionVolatility: number;

  // xu hướng so với snapshot trước
  @Prop({ default: 0 })
  trend: number;

  // baseline cá nhân (quan trọng)
  @Prop({ default: 0 })
  baselineNegativeRatio: number;

  // risk score dài hạn (0–1)
  @Prop({ required: true })
  riskScore: number;

  @Prop({ required: true })
  createdAt: Date;
}

export type UserEmotionSnapshotDocument = HydratedDocument<UserEmotionSnapshot>;

export const UserEmotionSnapshotSchema =
  SchemaFactory.createForClass(UserEmotionSnapshot);

UserEmotionSnapshotSchema.index({ userId: 1, window: 1 }, { unique: true });
