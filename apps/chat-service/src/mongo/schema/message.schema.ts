import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { Conversation } from './conversation.schema';
import { Emotion } from '@repo/dtos';
import { Attachment, AttachmentSchema } from './attachment.schema';


@Schema({ timestamps: true })
export class Message {
  @Prop({ required: true, unique: true })
  messageId: string;

  @Prop({
    type: Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true,
  })
  conversationId: Types.ObjectId;

  @Prop({ required: true, index: true })
  senderId: string;

  @Prop({ type: String, default: '' })
  content?: string;

  @Prop({ default: 'sent', enum: ['sent', 'delivered', 'seen'] })
  status: 'sent' | 'delivered' | 'seen';


  @Prop({ type: [String], default: [] })
  seenBy: string[];

  @Prop({
    type: {
      JOY: { type: Number, default: 0 },
      SADNESS: { type: Number, default: 0 },
      ANGER: { type: Number, default: 0 },
      FEAR: { type: Number, default: 0 },
      DISGUST: { type: Number, default: 0 },
      SURPRISE: { type: Number, default: 0 },
      NEUTRAL: { type: Number, default: 0 },
    },
    default: {},
  })
  reactionStats: Record<Emotion, number>;

  @Prop({ type: [AttachmentSchema], default: [] })
  attachments?: Attachment[];

  @Prop({ type: Types.ObjectId, ref: Message.name, default: null, index: true })
  replyTo?: Types.ObjectId; // ID của message mà message này reply

  @Prop({ type: Boolean, default: false, index: true })
  isDeleted: boolean;

  @Prop({ type: Date, default: null })
  deletedAt?: Date;
}

export type MessageDocument = HydratedDocument<Message>;

export const MessageSchema = SchemaFactory.createForClass(Message);

// Index phục vụ tra cứu & paginate
MessageSchema.index({ messageId: 1 }, { unique: true });

// Paginate trong 1 conversation: sort theo _id mới nhất
MessageSchema.index({ conversationId: 1, _id: -1 });

// Lấy message theo sender
MessageSchema.index({ senderId: 1, _id: -1 });
