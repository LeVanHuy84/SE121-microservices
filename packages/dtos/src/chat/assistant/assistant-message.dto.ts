import {
  IsUUID,
  IsNumber,
  IsObject,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class AssistantContextItemDto {
  @IsString()
  type: string;

  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsNumber()
  score?: number;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class AssistantMessageDto {
  @IsNotEmpty()
  @IsString()
  message: string;

  @IsOptional()
  @IsUUID()
  clientMessageId?: string;
}
