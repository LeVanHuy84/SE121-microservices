import { Expose, Type } from 'class-transformer';
import { MediaDTO } from '../common/media.dto';

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
  postId: string;

  @Expose()
  replyId?: string;

  @Expose()
  content: string;

  @Expose()
  @Type(() => MediaDTO)
  media?: MediaDTO;

  @Expose()
  @Type(() => CommentStatDTO)
  commentStat: CommentStatDTO;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
