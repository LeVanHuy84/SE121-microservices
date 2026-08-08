import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CallType } from './call-type.enum';

export class CreateCallDTO {
  @IsString()
  conversationId: string;

  @IsEnum(CallType)
  type: CallType;

  @IsOptional()
  @IsString()
  clientCallId?: string;
}
