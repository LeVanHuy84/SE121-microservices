import { PartialType } from "@nestjs/mapped-types";
import { Type } from "class-transformer";
import { IsOptional, IsString, ValidateNested } from "class-validator";
import { CreateUserDTO } from "./create-user.dto";

export class CoverImageDTO {
  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  publicId?: string;
}

export class UpdateUserDTO extends PartialType(CreateUserDTO) {
  @IsOptional()
  @ValidateNested()
  @Type(() => CoverImageDTO)
  coverImage?: CoverImageDTO;
}
