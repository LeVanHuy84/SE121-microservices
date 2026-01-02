import { Expose, Type } from 'class-transformer';
import { IsEnum } from 'class-validator';
import { Emotion, ReactionType, RootType } from '../enums/social.enum';
import { MediaItemDTO } from '../../common';

export class CommentStatDTO {
  @Expose() reactions: number;
  @Expose() likes: number;
  @Expose() loves: number;
  @Expose() hahas: number;
  @Expose() wows: number;
  @Expose() angrys: number;
  @Expose() sads: number;
  @Expose() replies: number;
}

export class CommentResponseDTO {
  @Expose()
  id: string;

  @Expose()
  userId: string;

  @Expose()
  @IsEnum(RootType)
  rootType: RootType;

  @Expose()
  rootId: string;

  @Expose()
  parentId: string;

  @Expose()
  content: string;

  @Expose()
  @Type(() => MediaItemDTO)
  media?: MediaItemDTO;

  @Expose()
  @Type(() => CommentStatDTO)
  commentStat: CommentStatDTO;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  isOwner: boolean;

  @Expose()
  @IsEnum(ReactionType)
  reactedType?: ReactionType;
}
