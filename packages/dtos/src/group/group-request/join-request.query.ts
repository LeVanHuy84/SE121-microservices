import { IsOptional, IsString, IsEnum } from 'class-validator';
import { CursorPaginationDTO } from '../../pagination';
import { JoinRequestStatus } from '../enums';

enum JoinRequestSortBy {
  CREATED_AT = 'createdAt',
}

export class JoinRequestFilter extends CursorPaginationDTO {
  @IsOptional()
  @IsEnum(JoinRequestSortBy)
  sortBy?: JoinRequestSortBy = JoinRequestSortBy.CREATED_AT;

  @IsOptional()
  @IsEnum(JoinRequestStatus)
  status?: JoinRequestStatus;
}
