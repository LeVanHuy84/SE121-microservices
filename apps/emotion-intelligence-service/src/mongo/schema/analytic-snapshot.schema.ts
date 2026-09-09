import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Emotion,
  LowCaseEmotion,
  MentalHealthRiskLevel,
  TargetType,
} from '@repo/dtos';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'emotion_analytics_snapshots' })
export class EmotionAnalyticsSnapshot {
  _id?: Types.ObjectId;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, index: true })
  targetId: string;

  @Prop({ type: String, enum: TargetType, required: true })
  targetType: TargetType;

  @Prop()
  modelVersion: string;

  @Prop({ type: String, required: true })
  finalEmotion: LowCaseEmotion;

  @Prop({ type: String, required: true })
  primaryEmotion: LowCaseEmotion;

  @Prop({ type: [String], default: [] })
  secondaryEmotions: LowCaseEmotion[];

  @Prop({
    type: Object,
    required: true,
  })
  finalScores: Record<LowCaseEmotion, number>;

  @Prop({ required: true })
  finalConfidence: number;

  @Prop({
    type: String,
    enum: MentalHealthRiskLevel,
    default: MentalHealthRiskLevel.NONE,
  })
  mentalHealthRiskLevel?: MentalHealthRiskLevel | string;

  @Prop({ type: Boolean, default: false })
  isSarcasmOrConflict?: boolean;

  @Prop({ required: true })
  createdAt: Date;
}

export type EmotionAnalyticsSnapshotDocument =
  HydratedDocument<EmotionAnalyticsSnapshot>;
export const EmotionAnalyticsSnapshotSchema = SchemaFactory.createForClass(
  EmotionAnalyticsSnapshot,
);

EmotionAnalyticsSnapshotSchema.index({ userId: 1, createdAt: 1 });
