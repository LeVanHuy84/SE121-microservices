import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDTO } from '../../pagination';
import { GroupStatus } from '../enums';

export enum GroupMemberRange {
  LT_100 = 'LT_100', // < 100
  BETWEEN_100_1000 = 'BETWEEN_100_1000',
  GT_1000 = 'GT_1000', // > 1000
}

export class AdminGroupQuery extends PaginationDTO {
  @IsOptional()
  name?: string;

  @IsOptional()
  @IsEnum(GroupStatus)
  status: GroupStatus;

  @IsOptional()
  @IsEnum(GroupMemberRange)
  memberRange?: GroupMemberRange;
}
