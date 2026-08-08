import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CallEndReason } from './call-end-reason.enum';

export class RejectCallDTO {
  @IsString()
  callId: string;

  @IsOptional()
  @IsEnum(CallEndReason)
  reason?: CallEndReason;
}
