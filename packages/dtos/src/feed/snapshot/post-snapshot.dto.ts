import { Expose, Type } from 'class-transformer';
import {
  Audience,
  Emotion,
  ReactionType,
} from '../../social/enums/social.enum';
import { MediaItemDTO } from '../../common/media.dto';
import { PostStatDTO } from '../../common';

export class PostSnapshotDTO {
  @Expose()
  postId: string;

  @Expose()
  userId: string;

  @Expose()
  groupId?: string;

  @Expose()
  audience?: Audience;

  @Expose()
  content?: string;

  @Expose()
  @Type(() => MediaItemDTO)
  mediaPreviews?: MediaItemDTO[];

  @Expose()
  mediaRemaining?: number;

  @Expose()
  mainEmotion?: Emotion;

  @Expose()
  createdAt: Date;

  @Expose()
  reactedType?: ReactionType;

  @Expose()
  @Type(() => PostStatDTO)
  postStat?: PostStatDTO;
}
