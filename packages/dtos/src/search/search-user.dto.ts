import { IsOptional } from 'class-validator';
import { CursorPaginationDTO } from '../pagination';

export class SearchUserDto extends CursorPaginationDTO {
  @IsOptional()
  query?: string;
  @IsOptional()
  email?: string;
  @IsOptional()
  firstName?: string;
  @IsOptional()
  lastName?: string;
  @IsOptional()
  isActive?: boolean = true;
}
