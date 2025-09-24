import { IsEnum, IsOptional } from 'class-validator';
import { Feeling, PostStatus } from '../enums/social.enum';
import { PaginationDTO } from '../../pagination/pagination.dto';

export class GetPostQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;

  @IsOptional()
  @IsEnum(Feeling)
  feeling?: Feeling;
}
