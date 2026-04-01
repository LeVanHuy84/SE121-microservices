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

  // EMA cảm xúc hiện tại
  @Prop({ type: Object, required: true })
  emotionVectorEMA: Record<string, number>;

  // độ tiêu cực gần đây (time-decayed)
  @Prop({ required: true, default: 0 })
  recentNegativityScore: number;

  // streak theo EVENT (không phải window)
  @Prop({ required: true, default: 0 })
  negativeEventStreak: number;

  // lần cuối có activity (rất quan trọng cho decay)
  @Prop()
  lastEventAt?: Date;

  // lần cuối có signal tiêu cực mạnh
  @Prop()
  lastStrongNegativeAt?: Date;

  // xu hướng gần đây
  @Prop({ default: 0 })
  emotionMomentum: number;

  updatedAt?: Date;
}

export type UserEmotionProfileDocument = HydratedDocument<UserEmotionProfile>;

export const UserEmotionProfileSchema =
  SchemaFactory.createForClass(UserEmotionProfile);

UserEmotionProfileSchema.index({ userId: 1 }, { unique: true });
