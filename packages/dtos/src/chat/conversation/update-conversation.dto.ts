import { Type } from "class-transformer";
import { ArrayUnique, IsArray, IsNotEmpty, IsOptional, IsString } from "class-validator";
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
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  participantsToAdd?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  participantsToRemove?: string[];
}