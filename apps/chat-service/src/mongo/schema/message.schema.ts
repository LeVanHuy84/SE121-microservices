import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Conversation } from './conversation.schema';

@Schema({ timestamps: true })
export class Message extends Document {
  @Prop({ required: true, unique: true })
  messageId: string;

  @Prop({ type: Types.ObjectId, ref: 'Conversation', required: true })
  conversationId: Types.ObjectId;

  @Prop({ required: true })
  senderId: string;

  @Prop()
  content: string;

  @Prop({ default: 'sent', enum: ['sent', 'delivered', 'seen'] })
  status: 'sent' | 'delivered' | 'seen';

  @Prop({ type: [String], default: [] })
  deliveredBy: string[];

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

  @Prop({ type: Types.ObjectId, ref: Message.name, default: null })
  replyTo?: Types.ObjectId; // ID của message mà message này reply

  @Prop({ type: Boolean, default: false })
  isDeleted: boolean;

  @Prop({ type: Date, default: null })
  deletedAt?: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

MessageSchema.index({ messageId: 1 }, { unique: true });
MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index({ senderId: 1 });

MessageSchema.index(
  { conversationId: 1, createdAt: -1 },
  { partialFilterExpression: { isDeleted: false } },
);
MessageSchema.index({ replyTo: 1 });
