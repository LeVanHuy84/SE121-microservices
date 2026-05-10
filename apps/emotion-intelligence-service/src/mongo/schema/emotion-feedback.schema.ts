import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Emotion, TargetType } from '@repo/dtos';
import { Document, HydratedDocument } from 'mongoose';

@Schema({ timestamps: true })
export class EmotionFeedback extends Document {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  targetId: string;

  @Prop({ required: true, enum: TargetType })
  targetType: TargetType;

  @Prop({ required: true })
  isAccurate: boolean;

  @Prop({ enum: Emotion })
  expectedEmotion?: Emotion;

  // Snapshot of the predicted emotion at the time of feedback, for auditing and analysis purposes
  @Prop({ required: true, enum: Emotion })
  predictedEmotion: Emotion;

  @Prop({ required: true })
  confidence: number;

  @Prop({ required: true })
  modelVersion: string;

  @Prop({ default: Date.now })
  createdAt: Date;
}

export type EmotionFeedbackDocument = HydratedDocument<EmotionFeedback>;
export const EmotionFeedbackSchema =
  SchemaFactory.createForClass(EmotionFeedback);
