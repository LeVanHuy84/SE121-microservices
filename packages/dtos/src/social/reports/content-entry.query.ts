import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDTO } from '../../pagination';
import { ContentStatus, TargetType } from '../enums';

export class ContentEntryQuery extends PaginationDTO {
  @IsOptional()
  query?: string;
  @IsOptional()
  @IsEnum(TargetType)
  targetType?: TargetType;
  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus;
  @IsOptional()
  createdAt?: Date;
}
