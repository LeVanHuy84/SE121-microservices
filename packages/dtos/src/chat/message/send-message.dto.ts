import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AttachmentDTO {
  @IsString()
  url: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  size?: number;

  @IsOptional()
  thumbnailUrl?: string;
}

export class SendMessageDTO {

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsEnum(['text', 'image', 'video', 'file', 'system'])
  messageType?: 'text' | 'image' | 'video' | 'file' | 'system';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDTO)
  attachments?: AttachmentDTO[];
}
