import { Type } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { MediaItemDTO } from '../common/media.dto';
import { RootType, TargetType } from '../enums/social.enum';

export class CreateCommentDTO {
  @IsUUID()
  rootId: string;

  @IsEnum(RootType)
  rootType: RootType;

  @IsUUID()
  @IsOptional()
  parentId?: string;

  @IsString()
  content: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaItemDTO)
  media?: MediaItemDTO;
}
