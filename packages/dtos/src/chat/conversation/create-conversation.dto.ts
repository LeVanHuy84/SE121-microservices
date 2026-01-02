import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, IsEnum, IsBoolean } from 'class-validator';
import { AttachmentDTO } from '../message';

export class CreateConversationDTO {

  @IsBoolean()
  isGroup: boolean;


  @IsArray()
  participants: string[];

  @IsOptional()
  @IsString()
  groupName?: string;

  @IsOptional()
  @Type(() => AttachmentDTO)
  
  groupAvatar?: AttachmentDTO;

}
