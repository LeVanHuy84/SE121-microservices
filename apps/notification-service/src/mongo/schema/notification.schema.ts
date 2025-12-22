// src/notification/schemas/notification.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ChannelNotification } from '@repo/dtos';
import { Document } from 'mongoose';

export type NotificationDocument = Notification & Document;

@Schema({ timestamps: true })
export class Notification {
  @Prop({ index: true, unique: false }) requestId?: string; // optional dedupe key
  @Prop({ required: true, index: true }) userId: string;
  @Prop({ required: true }) type: string;
  @Prop({ type: Object, default: {} }) payload: any;
  @Prop() message?: string;
  @Prop({ type: [String], default: ['web'] }) channels: string[];
  @Prop({ default: 'unread' }) status: 'unread' | 'read';
  @Prop({ default: 0 }) retries: number;
  @Prop() sendAt?: Date; // optional scheduled time
  @Prop({ type: Object, default: {} }) meta?: Record<string, any>;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
