import { Expose, Type } from 'class-transformer';

export class ReactionDTO {
  @Expose()
  userId: string;

  @Expose()
  emoji: string;
}

export class AttachmentResponseDTO {
  @Expose()
  url: string;

  @Expose()
  mimeType?: string;

  @Expose()
  fileName?: string;

  @Expose()
  size?: number;

  @Expose()
  thumbnailUrl?: string;
}

export class MessageResponseDTO {
  @Expose()
  _id: string;

  @Expose()
  conversationId: string;

  @Expose()
  senderId: string;

  @Expose()
  content?: string;

  @Expose()
  @Type(() => AttachmentResponseDTO)
  attachments?: AttachmentResponseDTO[];

  @Expose()
  seenBy: string[];

  @Expose()
  deliveredBy: string[];

  @Expose()
  @Type(() => ReactionDTO)
  reactions: ReactionDTO[];

  @Expose()
  status: 'sending' | 'sent' | 'delivered' | 'read';

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  @Type(() => MessageResponseDTO)
  replyTo?: MessageResponseDTO;

  @Expose()
  isDeleted: boolean;

  @Expose()
  deletedAt?: Date;
}
