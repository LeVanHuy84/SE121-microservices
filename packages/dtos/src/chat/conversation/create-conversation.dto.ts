import { IsArray, IsOptional, IsString, IsEnum, IsBoolean } from 'class-validator';

export class CreateConversationDTO {
  

  @IsArray()
  participants: string[];

  @IsOptional()
  @IsString()
  groupName?: string;

  @IsOptional()
  @IsString()
  groupAvatar?: string;

}
