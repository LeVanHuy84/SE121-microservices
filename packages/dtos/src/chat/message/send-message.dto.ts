import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  ValidateNested
} from 'class-validator';

export class AttachmentDTO {
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
  size?: number;

  @IsOptional()
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
