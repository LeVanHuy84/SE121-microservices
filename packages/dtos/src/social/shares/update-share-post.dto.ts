import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { Audience } from '../enums';

export class UpdateShareDTO {
  @IsOptional()
  @IsEnum(Audience)
  audience?: Audience;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  content: string;
}
