import { IsArray, IsOptional, IsString, IsEnum } from 'class-validator';

export class CreateConversationDTO {
  @IsEnum(['private', 'group'])
  type: 'private' | 'group';

  @IsArray()
  participants: string[];

  @IsOptional()
  @IsString()
  groupName?: string;

  @IsOptional()
  @IsString()
  groupAvatar?: string;
}
