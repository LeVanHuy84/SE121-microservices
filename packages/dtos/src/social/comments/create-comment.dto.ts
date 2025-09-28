import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { MediaDTO } from '../common/media.dto';

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
  @Type(() => MediaDTO)
  media?: MediaDTO;
}
