import { IsEnum, IsOptional } from 'class-validator';
import { Feeling } from '../enums/social.enum';
import { PaginationDTO } from '../../pagination/pagination.dto';

export class GetPostQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsEnum(Feeling)
  feeling?: Feeling;
}
