import { IsOptional, IsString } from 'class-validator';
import { CursorPaginationDTO } from '../pagination';

export class SearchPostDto extends CursorPaginationDTO {
  @IsString()
  query: string;
  @IsOptional()
  userId?: string;
  @IsOptional()
  groupId?: string;
  @IsOptional()
  emotion?: string;
}
