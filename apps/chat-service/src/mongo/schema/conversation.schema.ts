import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Conversation extends Document {
  @Prop({ required: true, enum: ['private', 'group'] })
  type: 'private' | 'group';

  @Prop({ type: [String], required: true })
  participants: string[];

  @Prop({ type: String })
  groupName?: string;

  @Prop({ type: String })
  groupAvatar?: string;

  @Prop({ type: [String] })
  admins?: string[];

  @Prop({ type: String })
  lastMessageId?: string;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

ConversationSchema.index({ participants: 1 });
