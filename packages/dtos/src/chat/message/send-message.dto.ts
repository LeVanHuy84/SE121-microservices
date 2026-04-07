import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsNumber,
  IsString,
  ValidateNested
} from 'class-validator';
import { MediaType } from '../../common';

export class AttachmentDTO {
  @IsOptional()
  @IsEnum(MediaType)
  type?: MediaType;

  @IsString()
  url: string;

  @IsOptional()
  @IsString()
  publicId?: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsNumber()
  size?: number;

  @IsOptional()
  @IsNumber()
  duration?: number;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;
}

export class SendMessageDTO {
  @IsString()
  conversationId: string;

  @IsOptional()
  @IsString()
  content?: string;


  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDTO)
  @ArrayMaxSize(5)
  attachments?: AttachmentDTO[];

  @IsOptional()
  @IsString()
  replyTo?: string;
}
