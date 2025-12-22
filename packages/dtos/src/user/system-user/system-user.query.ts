import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationDTO } from '../../pagination';
import { SystemRole, UserStatus } from '../enums';

export class SystemUserQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsString()
  query?: string;

  @IsOptional()
  @IsEnum(SystemRole)
  role?: SystemRole;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
