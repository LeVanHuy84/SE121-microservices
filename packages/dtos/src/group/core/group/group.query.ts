import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CursorPaginationDTO } from '../../../pagination';

export enum GroupSortBy {
  CREATED_AT = 'createdAt',
  GROUP_MEMBER_COUNT = 'members',
  GROUP_NAME = 'name',
}

export class SearchGroupDTO extends CursorPaginationDTO {
  @IsOptional()
  @IsString()
  q?: string; // từ khóa tìm kiếm (name, description, etc.)

  @IsOptional()
  @IsEnum(GroupSortBy)
  declare sortBy?: GroupSortBy;

  @IsOptional()
  @IsString()
  privacy?: string; // public/private nếu bạn có enum GroupPrivacy
}
