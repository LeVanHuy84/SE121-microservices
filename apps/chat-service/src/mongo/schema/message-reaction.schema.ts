import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";
import { Message } from "./message.schema";
import { Emotion } from "@repo/dtos";



@Schema({ timestamps: true })
export class MessageReaction {
  @Prop({
    type: Types.ObjectId,
    ref: Message.name,
    required: true,
    index: true,
  })
  messageId: Types.ObjectId;

  @Prop({ required: true, index: true })
  userId: string; // id user đã react

  @Prop({ required: true, enum: Emotion })
  emotion: Emotion;
}

export type MessageReactionDocument = HydratedDocument<MessageReaction>;

export const MessageReactionSchema =
  SchemaFactory.createForClass(MessageReaction);

// 1 user chỉ có 1 reaction trên 1 message (có thể update emotion)
MessageReactionSchema.index({ messageId: 1, userId: 1 }, { unique: true });
