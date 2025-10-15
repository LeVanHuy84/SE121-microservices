import { Expose } from "class-transformer";

export class ConversationResponseDTO {
  @Expose()
  id: string;

  @Expose()
  type: 'private' | 'group';

  @Expose()
  participants: string[];

  @Expose()
  groupName?: string;

  @Expose()
  groupAvatar?: string;
  

  @Expose()
  lastMessageId?: string;

  @Expose()
  admins?: string[];

  @Expose()
  createdAt: Date;
}