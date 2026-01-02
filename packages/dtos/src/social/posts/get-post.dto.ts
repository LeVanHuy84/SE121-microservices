import { Expose, Type } from 'class-transformer';
import { Audience, Emotion, ReactionType } from '../enums/social.enum';
import { IsEnum } from 'class-validator';
import { MediaItemDTO, PostStatDTO } from '../../common';
import { GroupInfoDTO } from '../../feed';

export class PostResponseDTO {
  @Expose()
  id: string;

  @Expose()
  userId: string;

  @Expose()
  group?: GroupInfoDTO;

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
  @IsEnum(Emotion)
  mainEmotion?: Emotion;

  @Expose()
  mainEmotionScore?: number;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  reactedType?: ReactionType;
}
