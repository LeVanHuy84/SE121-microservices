import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TargetType } from '../enums/social.enum';
import { PaginationDTO } from '../../pagination/pagination.dto';

export class GetReactionsDTO extends PaginationDTO {
  @IsUUID()
  targetId: string;

  @IsOptional()
  @IsEnum(TargetType)
  targetType: TargetType;
}
