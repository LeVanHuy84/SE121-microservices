import { Expose, Type } from 'class-transformer';
import { Audience, Emotion, ReactionType } from '../enums/social.enum';
import { MediaItemDTO } from '../common/media.dto';
import { IsEnum } from 'class-validator';

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
  @IsEnum(Emotion)
  feeling: Emotion;

  @Expose()
  content: string;

  @Expose()
  @Type(() => MediaItemDTO)
  media: MediaItemDTO[];

  @Expose()
  audience: Audience;

  @Expose()
  @Type(() => PostStatDTO)
  postStat: PostStatDTO;

  @Expose()
  mainEmotion?: string;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  reactedType?: ReactionType;
}
