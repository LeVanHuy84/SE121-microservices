import { IsOptional, IsUUID } from 'class-validator';
import { CursorPaginationDTO } from '../../pagination';

export class GroupReportQuery extends CursorPaginationDTO {
  @IsOptional()
  @IsUUID()
  groupId?: string;
}
