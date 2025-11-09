import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { GroupPrivacy } from '../../enums';

export class CreateGroupDTO {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  avatarUrl: string;

  @IsString()
  @IsOptional()
  coverImageUrl?: string;

  @IsEnum(GroupPrivacy)
  privacy: GroupPrivacy;

  @IsString()
  @IsOptional()
  rules?: string;

  @IsUUID()
  @IsOptional()
  groupCategoryId?: string;
}
