import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDTO } from '../pagination';
import { TargetType } from '../social';

export class GetMyModerationQuery extends PaginationDTO {
  @IsOptional()
  @IsEnum(TargetType)
  targetType?: TargetType;
}
