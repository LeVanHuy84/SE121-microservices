import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { GroupPrivacy } from '../../enums';
import { MediaItemDTO } from '../../../common';
import { Type } from 'class-transformer';

export class CreateGroupDTO {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @Type(() => MediaItemDTO)
  avatar: MediaItemDTO;

  @Type(() => MediaItemDTO)
  @IsOptional()
  coverImage?: MediaItemDTO;

  @IsEnum(GroupPrivacy)
  privacy: GroupPrivacy;

  @IsString()
  @IsOptional()
  rules?: string;

  @IsUUID()
  @IsOptional()
  groupCategoryId?: string;
}
