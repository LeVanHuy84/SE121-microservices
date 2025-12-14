import { Type } from "class-transformer";
import { IsArray, IsOptional, IsString } from "class-validator";
import { AttachmentDTO } from "../message";

export class UpdateConversationDTO {
  @IsOptional()
  @IsString()
  groupName?: string;

  @IsOptional()
  @Type(() => AttachmentDTO)
  groupAvatar?: AttachmentDTO;

  @IsOptional()
  @IsArray()
  participantsToAdd?: string[];

  @IsOptional()
  @IsArray()
  participantsToRemove?: string[];

}