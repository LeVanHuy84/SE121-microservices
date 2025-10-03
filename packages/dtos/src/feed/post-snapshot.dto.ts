import { IsOptional, IsString, IsUUID } from 'class-validator';
import { MediaDTO } from '../social/common/media.dto';
import { Type } from 'class-transformer';

export class PostSnapshotDTO {
  @IsUUID()
  postId: string;

  @IsUUID()
  userId: string;

  @IsOptional()
  groupId?: string;

  @IsOptional()
  @IsString()
  contentSnippet?: string;

  @IsOptional()
  @Type(() => MediaDTO)
  mediaPreview?: MediaDTO;
}
