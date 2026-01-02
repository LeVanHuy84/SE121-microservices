import { IsEnum, IsOptional } from 'class-validator';
import { Audience } from '../enums/social.enum';
import { CursorPaginationDTO } from '../../pagination';

export class ShareFilterQuery extends CursorPaginationDTO {
  @IsOptional()
  userId?: string;

  @IsOptional()
  postId?: string;

  @IsOptional()
  @IsEnum(Audience)
  audience?: Audience;
}
