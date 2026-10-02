import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDTO } from '../../pagination';
import { ModerationAction, Severity, TargetType } from '../../social';
import { FinalDecisionFilter } from '../enums';

export class AdminModerationQuery extends PaginationDTO {
  @IsOptional()
  @IsEnum(TargetType)
  targetType?: TargetType;

  @IsOptional()
  @IsEnum(ModerationAction)
  action?: ModerationAction;

  @IsOptional()
  @IsEnum(Severity)
  maxSeverity?: Severity;

  @IsOptional()
  @IsEnum(FinalDecisionFilter)
  finalDecision?: FinalDecisionFilter;

  @IsOptional()
  fromDate?: Date;

  @IsOptional()
  toDate?: Date;
}

