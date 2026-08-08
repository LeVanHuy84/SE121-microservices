import { Expose } from 'class-transformer';
import { CallEndReason } from './call-end-reason.enum';
import { CallSessionStatus } from './call-session-status.enum';
import { CallType } from './call-type.enum';

export class CallSessionResponseDTO {
  @Expose()
  _id: string;

  @Expose()
  conversationId: string;

  @Expose()
  initiatorId: string;

  @Expose()
  participants: string[];

  @Expose()
  isGroupCall?: boolean;

  @Expose()
  maxParticipants?: number;

  @Expose()
  type: CallType;

  @Expose()
  status: CallSessionStatus;

  @Expose()
  startedAt?: Date;

  @Expose()
  endedAt?: Date;

  @Expose()
  endReason?: CallEndReason;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  callMessageId?: string;
}
