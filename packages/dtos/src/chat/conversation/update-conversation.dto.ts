import { IsArray, IsOptional, IsString } from "class-validator";

export class UpdateConversationDTO {
  @IsOptional()
  @IsString()
  groupName?: string;

  @IsOptional()
  @IsString()
  groupAvatar?: string;

  @IsOptional()
  @IsArray()
  participantsToAdd?: string[];

  @IsOptional()
  @IsArray()
  participantsToRemove?: string[];

}