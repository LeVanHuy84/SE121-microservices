import { Expose, Type } from 'class-transformer';
import { MediaDto } from '../common/media.dto';

export class CommentStatDto {
  @Expose() reactions: number;
  @Expose() likes: number;
  @Expose() loves: number;
  @Expose() hahas: number;
  @Expose() wows: number;
  @Expose() angrys: number;
  @Expose() sads: number;
  @Expose() replies: number;
}

export class CommentResponseDto {
  @Expose()
  id: string;

  @Expose()
  userId: string;

  @Expose()
  postId: string;

  @Expose()
  replyId?: string;

  @Expose()
  content: string;

  @Expose()
  @Type(() => MediaDto)
  media?: MediaDto;

  @Expose()
  @Type(() => CommentStatDto)
  commentStat: CommentStatDto;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
