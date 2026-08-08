import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { CallType } from '../chat/call/call-type.enum';

export class SendCallPushDto {
  @IsString()
  userId: string;

  @IsString()
  conversationId: string;

  @IsBoolean()
  isGroup: boolean;

  @IsString()
  callerId: string;

  @IsString()
  callerName: string;

  @IsOptional()
  @IsString()
  callerAvatar?: string;

  @IsOptional()
  @IsString()
  conversationName?: string;

  @IsString()
  callId: string;

  @IsEnum(CallType)
  callType: CallType;
}
