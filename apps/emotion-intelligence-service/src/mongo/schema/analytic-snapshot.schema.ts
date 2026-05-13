import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Emotion, LowCaseEmotion, RiskHintLevel, TargetType } from '@repo/dtos';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'emotion_analytics_snapshots' })
export class EmotionAnalyticsSnapshot {
  _id?: Types.ObjectId;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, index: true })
  targetId: string;

  @Prop({ enum: TargetType, required: true })
  targetType: TargetType;

  @Prop()
  modelVersion: string;

  @Prop({ required: true })
  finalEmotion: LowCaseEmotion;

  @Prop({
    type: Object,
    required: true,
  })
  finalScores: Record<LowCaseEmotion, number>;

  @Prop({ required: true })
  finalConfidence: number;

  @Prop({ enum: RiskHintLevel, default: RiskHintLevel.NONE })
  riskHintLevel: RiskHintLevel;

  @Prop({ required: true })
  createdAt: Date;
}

export type EmotionAnalyticsSnapshotDocument =
  HydratedDocument<EmotionAnalyticsSnapshot>;
export const EmotionAnalyticsSnapshotSchema = SchemaFactory.createForClass(
  EmotionAnalyticsSnapshot,
);

EmotionAnalyticsSnapshotSchema.index({ userId: 1, createdAt: 1 });
