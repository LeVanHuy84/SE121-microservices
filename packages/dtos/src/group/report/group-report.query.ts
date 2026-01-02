import { IsOptional, IsUUID } from 'class-validator';
import { CursorPaginationDTO } from '../../pagination';
import { ReportStatus } from '../../social';

export class GroupReportQuery extends CursorPaginationDTO {
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsOptional()
  status: ReportStatus;
}
