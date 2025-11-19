import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Message } from './message.schema';

@Schema({ timestamps: true })
export class Conversation extends Document {
  @Prop({ type: Boolean, default: false })
  isGroup: boolean;

  @Prop({ type: [String], required: true })
  participants: string[];

  @Prop({ type: String })
  groupName?: string;

  @Prop({ type: String })
  groupAvatar?: string;

  @Prop({ type: [String] })
  admins?: string[];

  @Prop({ type: Types.ObjectId, ref: 'Message', default: null })
  lastMessage?: Types.ObjectId;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

// Index cho query participants nhanh
ConversationSchema.index({ participants: 1 });

// Index cho query 1-1 cực nhanh
ConversationSchema.index({ isGroup: 1, participants: 1 });

// Index cho sort theo updated time (phục vụ Redis cache fallback)
ConversationSchema.index({ participants: 1, updatedAt: -1 }); 

// Đảm bảo participants luôn sorted → cache bền, query ổn định
ConversationSchema.pre('save', function (next) {
  if (this.participants) {
    this.participants = [...new Set(this.participants)].sort();
  }
  if (this.admins) {
    this.admins = [...new Set(this.admins)].sort();
  }
  next();
});