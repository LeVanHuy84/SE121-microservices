import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDTO } from '../pagination';
import { ModerationAction, TargetType } from '../social';

export class GetMyModerationQuery extends PaginationDTO {
  @IsOptional()
  @IsEnum(TargetType)
  targetType?: TargetType;

  @IsOptional()
  @IsEnum(ModerationAction)
  action?: ModerationAction;
}

