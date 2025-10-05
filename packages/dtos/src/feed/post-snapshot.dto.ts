import { MediaItemDTO } from '../social/common/media.dto';
import { Expose, Type } from 'class-transformer';

export class PostSnapshotDTO {
  @Expose()
  postId: string;

  @Expose()
  userId: string;

  @Expose()
  groupId?: string;

  @Expose()
  content?: string;

  @Expose()
  @Type(() => MediaItemDTO)
  mediaPreview?: MediaItemDTO;

  @Expose()
  mediaRemaining?: number;

  @Expose()
  createdAt: Date;
}
