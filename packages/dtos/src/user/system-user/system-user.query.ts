import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationDTO } from '../../pagination';
import { SystemRole } from '../enums';

export class SystemUserQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsEnum(SystemRole)
  role?: SystemRole;
}
