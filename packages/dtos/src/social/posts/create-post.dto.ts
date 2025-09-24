import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Audience } from '../enums/social.enum';
import { Type } from 'class-transformer';
import { MediaDTO } from '../common/media.dto';

export class CreatePostDTO {
  @IsOptional()
  @IsString()
  groupId?: string; // NULL = cá nhân, NOT NULL = group

  @IsString()
  @Length(1, 10000)
  content: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDTO)
  media?: MediaDTO;

  @IsOptional()
  @IsEnum(Audience)
  audience?: Audience;
}
