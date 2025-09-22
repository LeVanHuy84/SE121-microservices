import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Audience } from '../enums/social.enum';
import { Type } from 'class-transformer';
import { MediaDto } from '../common/media.dto';

export class CreatePostDto {
  @IsOptional()
  @IsString()
  groupId?: string; // NULL = cá nhân, NOT NULL = group

  @IsString()
  @Length(1, 10000)
  content: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  media?: MediaDto;

  @IsOptional()
  @IsEnum(Audience)
  audience?: Audience;
}
