import { Expose, Type } from 'class-transformer';
import { Audience, Feeling, PostStatus } from '../enums/social.enum';
import { MediaDTO } from '../common/media.dto';
import { BaseUserDTO } from '../../user/get-user.dto';
import { IsEnum, IsString } from 'class-validator';

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
  userId: string;

  @Expose()
  groupId?: string;

  @Expose()
  @IsEnum(Feeling)
  feeling: Feeling;

  @Expose()
  content: string;

  @Expose()
  @Type(() => MediaDTO)
  media: MediaDTO;

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
