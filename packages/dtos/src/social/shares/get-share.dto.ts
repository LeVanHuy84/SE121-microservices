import { ShareStatDTO } from '../../common';
import { Audience, ReactionType } from '../enums/social.enum';
import { PostResponseDTO } from '../posts/get-post.dto';
import { Expose, Type } from 'class-transformer';

export class ShareResponseDTO {
  @Expose()
  id: string;

  @Expose()
  userId: string;

  @Expose()
  audience: Audience;

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

  @Expose()
  reactedType?: ReactionType;
}
