import { IsEnum, IsOptional } from 'class-validator';
import { CursorPaginationDTO } from '../../pagination';
import { GroupEventLog } from '../enums';

export class GroupLogFilter extends CursorPaginationDTO {
  @IsOptional()
  startTime?: Date;

  @IsOptional()
  endTime?: Date;

  @IsOptional()
  @IsEnum(GroupEventLog)
  eventType?: GroupEventLog;
}
