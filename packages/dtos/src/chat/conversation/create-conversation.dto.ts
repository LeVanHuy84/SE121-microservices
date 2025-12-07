import { IsArray, IsOptional, IsString, IsEnum, IsBoolean } from 'class-validator';

export class CreateConversationDTO {

  @IsBoolean()
  isGroup: boolean;


  @IsArray()
  participants: string[];

  @IsOptional()
  @IsString()
  groupName?: string;

  @IsOptional()
  @IsString()
  groupAvatar?: string;

}
