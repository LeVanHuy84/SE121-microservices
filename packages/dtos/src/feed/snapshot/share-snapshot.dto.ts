import { Expose, Type } from 'class-transformer';
import { PostSnapshotDTO } from './post-snapshot.dto';
import { Audience, ReactionType } from '../../social/enums/social.enum';
import { ShareStatDTO } from '../../common';

import { BaseUserDTO } from '../../user/get-user.dto';

export class ShareSnapshotDTO {
  @Expose()
  shareId: string;

  @Expose()
  userId: string;

  @Expose()
  @Type(() => BaseUserDTO)
  user?: BaseUserDTO;

  @Expose()
  audience?: Audience;

  @Expose()
  content?: string;

  @Expose()
  @Type(() => PostSnapshotDTO)
  post?: PostSnapshotDTO;

  @Expose()
  createdAt: Date;

  @Expose()
  reactedType?: ReactionType;

  @Expose()
  @Type(() => ShareStatDTO)
  shareStat?: ShareStatDTO;
}
