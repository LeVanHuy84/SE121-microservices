import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Message extends Document {
  @Prop({ required: true })
  conversationId: string;

  @Prop({ required: true })
  senderId: string;

  @Prop()
  content: string;

  @Prop({ default: 'text' })
  messageType: 'text' | 'image' | 'video' | 'file' | 'system';

  @Prop({ default: 'sending' })
  status: 'sending' | 'sent' | 'delivered' | 'seen';

  @Prop({ type: [String], default: [] })
  seenBy: string[];

  @Prop({ type: [Object], default: [] })
  reactions: { userId: string; emoji: string }[];

  @Prop({ type: [Object], default: [] })
  attachments?: {
    url: string; // link file
    fileName?: string;
    mimeType?: string;
    size?: number; // bytes
    thumbnailUrl?: string; // cho video hoặc ảnh
  }[];
}

export const MessageSchema = SchemaFactory.createForClass(Message);

MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index({ senderId: 1 });
