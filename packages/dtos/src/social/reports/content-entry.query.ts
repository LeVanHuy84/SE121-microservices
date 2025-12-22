import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDTO } from '../../pagination';
import { TargetType } from '../enums';

export class ContentEntryQuery extends PaginationDTO {
  @IsOptional()
  query?: string;
  @IsOptional()
  @IsEnum(TargetType)
  targetType?: TargetType;
  @IsOptional()
  createdAt?: Date;
}
