import { IsEnum, IsOptional, Max } from 'class-validator';
import { CursorPaginationDTO } from '../../pagination';
import { ActivityType } from '../enums';

export class GetUserActivityLogQuery extends CursorPaginationDTO {
  @IsOptional()
  @IsEnum(ActivityType)
  activityType?: ActivityType;
}
