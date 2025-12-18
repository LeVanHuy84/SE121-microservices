import { Expose, Type } from "class-transformer";
import { AttachmentResponseDTO, MessageResponseDTO } from "../message/get-message.dto";

export class ConversationResponseDTO {
  @Expose()
  _id: string;

  @Expose()
  isGroup: boolean;

  @Expose()
  participants: string[];

  @Expose()
  @Type(() => AttachmentResponseDTO)
  groupAvatar?: AttachmentResponseDTO;

  @Expose()
  groupName: string;

  @Expose()
  @Type(() => MessageResponseDTO)
  lastMessage?: MessageResponseDTO;

  @Expose()
  admins?: string[];

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  lastSeenMessageId?: Map<string, string>;

  @Expose()
  hiddenFor?: string[];
}