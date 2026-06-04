import { PartialType } from "@nestjs/mapped-types";
import { Type } from "class-transformer";
import { IsOptional, IsString, ValidateNested, IsEnum } from "class-validator";
import { CreateUserDTO } from "./create-user.dto";
import { PrivacyLevel, MessagePrivacy } from "./enums";

export class CoverImageDTO {
  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  publicId?: string;
}

export class UserPrivacySettingsDTO {
  @IsOptional()
  @IsEnum(PrivacyLevel)
  profileVisibility?: PrivacyLevel;

  @IsOptional()
  @IsEnum(MessagePrivacy)
  messagePrivacy?: MessagePrivacy;

  @IsOptional()
  @IsEnum(PrivacyLevel)
  friendListVisibility?: PrivacyLevel;
}

export class UpdateUserDTO extends PartialType(CreateUserDTO) {
  @IsOptional()
  @ValidateNested()
  @Type(() => CoverImageDTO)
  coverImage?: CoverImageDTO;

  @IsOptional()
  @ValidateNested()
  @Type(() => UserPrivacySettingsDTO)
  privacySettings?: UserPrivacySettingsDTO;
}
