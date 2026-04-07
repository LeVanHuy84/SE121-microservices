import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DeviceTokenDocument = HydratedDocument<DeviceToken>;

@Schema({
  collection: 'device-tokens',
  timestamps: true,
  versionKey: false,
})
export class DeviceToken {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  token: string;

  @Prop({ required: true, enum: ['ios', 'android', 'web'] })
  platform: string;

  @Prop({ required: true, enum: ['fcm'], default: 'fcm' })
  provider: 'fcm';

  @Prop({ type: String })
  appId?: string;

  @Prop({ type: String })
  deviceId?: string;

  @Prop({ type: String })
  deviceName?: string;

  @Prop({ type: Date, default: Date.now })
  lastUsed: Date;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;
}

export const DeviceTokenSchema = SchemaFactory.createForClass(DeviceToken);

// Compound index để tránh duplicate token
DeviceTokenSchema.index({ userId: 1, token: 1, provider: 1 }, { unique: true });
