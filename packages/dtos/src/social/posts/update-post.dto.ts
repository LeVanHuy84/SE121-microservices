import { IsEnum, IsOptional, IsString } from "class-validator";
import { Audience } from "../enums/social.enum";

export class UpdatePostDto {
  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsEnum(Audience)
  audience?: Audience;
}
