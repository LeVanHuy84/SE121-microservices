import { IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../pagination/pagination.dto';

export class GetCommentQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  postId?: string;

  @IsOptional()
  @IsUUID()
  replyId?: string;
}
