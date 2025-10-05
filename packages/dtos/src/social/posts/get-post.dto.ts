import { Expose, Type } from 'class-transformer';
import { Audience, PostStatus } from '../enums/social.enum';
import { BaseUserDTO } from '../../user/get-user.dto';
import { MediaItemDTO } from '../common/media.dto';

export class PostStatDTO {
  @Expose() reactions: number;
  @Expose() likes: number;
  @Expose() loves: number;
  @Expose() hahas: number;
  @Expose() wows: number;
  @Expose() angrys: number;
  @Expose() sads: number;
  @Expose() comments: number;
  @Expose() shares: number;
}

export class PostResponseDTO {
  @Expose()
  id: string;

  @Expose()
  @Type(() => BaseUserDTO)
  user: BaseUserDTO | null;

  @Expose()
  groupId?: string;

  @Expose()
  content: string;

  @Expose()
  @Type(() => MediaItemDTO)
  media: MediaItemDTO;

  @Expose()
  audience: Audience;

  @Expose()
  @Type(() => PostStatDTO)
  postStat: PostStatDTO;

  @Expose()
  mainEmotion?: string;

  @Expose()
  status: PostStatus;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
