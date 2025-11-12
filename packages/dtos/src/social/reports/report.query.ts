import { IsEnum, IsOptional } from 'class-validator';
import { CursorPaginationDTO } from '../../pagination';
import { ReportStatus, TargetType } from '../enums';

export class ReportFilterDTO extends CursorPaginationDTO {
  @IsOptional()
  groupId?: string;

  @IsOptional()
  reporterId?: string;

  @IsOptional()
  @IsEnum(TargetType)
  targetType?: TargetType;

  @IsOptional()
  targetId?: string;

  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;
}
