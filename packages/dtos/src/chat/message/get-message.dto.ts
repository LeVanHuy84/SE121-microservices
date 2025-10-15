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
  id: string;

  @Expose()
  conversationId: string;

  @Expose()
  senderId: string;

  @Expose()
  content?: string;

  @Expose()
  messageType: 'text' | 'image' | 'video' | 'file' | 'system';

  @Expose()
  @Type(() => AttachmentResponseDTO)
  attachments?: AttachmentResponseDTO[];

  @Expose()
  seenBy: string[];

  @Expose()
  @Type(() => ReactionDTO)
  reactions: ReactionDTO[];

  @Expose()
  deliveryStatus: 'sending' | 'sent' | 'delivered' | 'read';

  @Expose()
  createdAt: Date;
}
