import { PostResponseDTO } from '../posts/get-post.dto';
import { Expose, Type } from 'class-transformer';

export class ShareStatDTO {
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

export class ShareResponseDTO {
  @Expose()
  id: string;

  @Expose()
  userId: string;

  @Expose()
  content: string;

  @Expose()
  @Type(() => Date)
  createdAt: Date;

  @Expose()
  @Type(() => PostResponseDTO)
  post: PostResponseDTO;

  @Expose()
  @Type(() => ShareStatDTO)
  shareStat: ShareStatDTO;
}
