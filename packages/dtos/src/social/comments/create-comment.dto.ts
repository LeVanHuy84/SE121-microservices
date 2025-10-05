import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { MediaItemDTO } from '../common/media.dto';

export class CreateCommentDTO {
  @IsUUID()
  postId: string;

  @IsOptional()
  @IsUUID()
  replyId?: string;

  @IsString()
  content: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaItemDTO)
  media?: MediaItemDTO;
}
