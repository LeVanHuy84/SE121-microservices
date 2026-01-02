import { IsEnum, IsOptional, IsString } from 'class-validator';
import { GroupPrivacy } from '../../enums';
import { MediaItemDTO } from '../../../common';

export class UpdateGroupDTO {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  avatar?: MediaItemDTO;

  @IsString()
  @IsOptional()
  coverImage?: MediaItemDTO;

  @IsOptional()
  @IsEnum(GroupPrivacy)
  privacy?: GroupPrivacy;

  @IsString()
  @IsOptional()
  rules?: string;
}
