import { IsOptional, IsUUID } from 'class-validator';
import { PaginationDTO } from '../../pagination/pagination.dto';

export class GetCommentQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsUUID()
  postId?: string;

  @IsOptional()
  @IsUUID()
  replyId?: string;
}
