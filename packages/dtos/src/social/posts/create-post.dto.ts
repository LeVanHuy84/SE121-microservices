import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Audience, Feeling } from '../enums/social.enum';
import { Type } from 'class-transformer';
import { MediaItemDTO } from '../common/media.dto';

export class CreatePostDTO {
  @IsOptional()
  @IsString()
  groupId?: string; // NULL = cá nhân, NOT NULL = group

  @IsOptional()
  @IsEnum(Feeling)
  feeling: Feeling;

  @IsString()
  @Length(1, 10000)
  content: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaItemDTO)
  media?: MediaItemDTO[];

  @IsOptional()
  @IsEnum(Audience)
  audience?: Audience;
}
