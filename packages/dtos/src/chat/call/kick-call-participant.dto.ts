import { IsString } from 'class-validator';

export class KickCallParticipantDTO {
  @IsString()
  callId: string;

  @IsString()
  targetUserId: string;
}
