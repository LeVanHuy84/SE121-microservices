import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CursorPaginationDTO } from '../pagination';
import { GroupPrivacy } from '../group';

export enum SearchGroupSortBy {
  MEMBERS = 'members',
  CREATED_AT = 'createdAt',
}

export class SearchGroupDto extends CursorPaginationDTO {
  @IsString()
  query: string;

  @IsOptional()
  groupId?: string;

  @IsOptional()
  @IsEnum(GroupPrivacy)
  privacy?: GroupPrivacy;

  @IsEnum(SearchGroupSortBy)
  declare sortBy?: SearchGroupSortBy;
}
