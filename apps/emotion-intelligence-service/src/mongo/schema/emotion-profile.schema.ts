import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({
  collection: 'user_emotion_profiles',
  timestamps: { createdAt: false, updatedAt: true },
})
export class UserEmotionProfile {
  _id?: Types.ObjectId;

  @Prop({ required: true, unique: true, index: true })
  userId: string;

  // EMA cảm xúc 7 nhãn (joy, sadness, anger, fear, disgust, surprise, neutral)
  @Prop({ type: Object, required: true })
  emotionVectorEMA: Record<string, number>;

  // Điểm tiêu cực tích lũy theo thời gian (Time-Decay)
  @Prop({ required: true, default: 0 })
  decayedNegativityScore: number;

  // Streak theo ngày liên tiếp có chỉ số tiêu cực (Daily Window Streak)
  @Prop({ required: true, default: 0 })
  consecutiveNegativeDays: number;

  // Lần cuối có activity (tính toán Time-Decay Δt)
  @Prop()
  lastEventAt?: Date;

  // Lần cuối có signal tiêu cực mạnh
  @Prop()
  lastStrongNegativeAt?: Date;

  // Xu hướng biến đổi cảm xúc (>0 xấu đi, <0 phục hồi)
  @Prop({ default: 0 })
  emotionMomentum: number;

  updatedAt?: Date;
}

export type UserEmotionProfileDocument = HydratedDocument<UserEmotionProfile>;

export const UserEmotionProfileSchema =
  SchemaFactory.createForClass(UserEmotionProfile);

UserEmotionProfileSchema.index({ userId: 1 }, { unique: true });
