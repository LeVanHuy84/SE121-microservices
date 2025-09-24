import { Expose, Type } from "class-transformer";
import { Audience, PostStatus } from "../enums/social.enum";
import { MediaDto } from "../common/media.dto";

export class PostStatDto {
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

export class PostResponseDto {
  @Expose()
  id: string;

  @Expose()
  userId: string;

  @Expose()
  groupId?: string;

  @Expose()
  content: string;

  @Expose()
  @Type(() => MediaDto)
  media: MediaDto;

  @Expose()
  audience: Audience;

  @Expose()
  @Type(() => PostStatDto)
  postStat: PostStatDto;

  @Expose()
  mainEmotion?: string;

  @Expose()
  status: PostStatus;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
