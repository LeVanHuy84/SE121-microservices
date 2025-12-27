import { Expose, Type } from 'class-transformer';
import { ReactionStatsDTO } from './message-reaction-stats.dto';
import { AttachmentDTO } from './send-message.dto';

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
  publicId?: string;

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
  @Type(() => ReactionStatsDTO)
  reactionStats: ReactionStatsDTO;

  @Expose()
  status: 'sent' | 'delivered' | 'seen';

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

  @Expose()
  syncVersion?: number;
}
