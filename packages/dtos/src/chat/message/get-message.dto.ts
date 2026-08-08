import { Expose, Type } from 'class-transformer';
import { ReactionStatsDTO } from './message-reaction-stats.dto';
import { MediaType } from '../../common';
import { CallEndReason } from '../call/call-end-reason.enum';
import { CallSessionStatus } from '../call/call-session-status.enum';
import { CallType } from '../call/call-type.enum';

export class ReactionDTO {
  @Expose()
  userId: string;

  @Expose()
  emoji: string;
}

export class AttachmentResponseDTO {
  @Expose()
  type?: MediaType;

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
  duration?: number;

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
  messageType?: 'text' | 'system_call';

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

  @Expose()
  systemMeta?: {
    kind?: 'call';
    callId?: string;
    callType?: CallType;
    callStatus?: CallSessionStatus;
    endedReason?: CallEndReason;
    durationSec?: number;
    actorId?: string;
  };
}
