import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { GroupPrivacy } from '../../enums';

export class UpdateGroupDTO {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  coverImage?: string;

  @IsOptional()
  @IsEnum(GroupPrivacy)
  privacy?: GroupPrivacy;

  @IsString()
  @IsOptional()
  rules?: string;

  @IsUUID()
  @IsOptional()
  groupCategoryId?: string;
}
