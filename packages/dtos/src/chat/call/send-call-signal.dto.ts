import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { CallSignalType } from './call-signal-type.enum';

export class SendCallSignalDTO {
  @IsString()
  callId: string;

  @IsString()
  targetUserId: string;

  @IsEnum(CallSignalType)
  signalType: CallSignalType;

  @IsOptional()
  @IsString()
  sdp?: string;

  @IsOptional()
  @IsString()
  candidate?: string;

  @IsOptional()
  @IsString()
  sdpMid?: string;

  @IsOptional()
  @IsInt()
  sdpMLineIndex?: number;
}
