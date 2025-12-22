import { IsEnum, IsOptional } from 'class-validator';
import { CursorPaginationDTO } from '../../pagination';
import { LogType } from '../enums';

export class AuditLogQuery extends CursorPaginationDTO {
  @IsOptional()
  @IsEnum(LogType)
  logType?: LogType;

  @IsOptional()
  actorId?: string;
}
