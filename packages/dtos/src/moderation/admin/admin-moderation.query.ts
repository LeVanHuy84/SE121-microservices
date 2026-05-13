import { IsOptional } from 'class-validator';
import { PaginationDTO } from '../../pagination';
import { Severity, TargetType } from '../../social';
import { FinalDecision } from '../enums';

export class AdminModerationQuery extends PaginationDTO {
  @IsOptional()
  targetType?: TargetType;

  @IsOptional()
  maxSeverity?: Severity;

  @IsOptional()
  finalDecision?: FinalDecision;

  @IsOptional()
  fromDate?: Date;

  @IsOptional()
  toDate?: Date;
}
