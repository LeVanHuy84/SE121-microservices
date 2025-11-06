import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Audience } from '../enums';

export class CreateShareDTO {
  @IsUUID()
  postId: string;

  @IsOptional()
  @IsEnum(Audience)
  audience?: Audience;

  @IsString()
  @Length(1, 2000)
  content: string;
}
