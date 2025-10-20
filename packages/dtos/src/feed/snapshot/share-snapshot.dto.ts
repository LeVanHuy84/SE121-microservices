import { Expose, Type } from 'class-transformer';
import { PostSnapshotDTO } from './post-snapshot.dto';
import { ReactionType } from '../../social/enums/social.enum';
import { ShareStatDTO } from '../../common';

export class ShareSnapshotDTO {
  @Expose()
  shareId: string;

  @Expose()
  userId: string;

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
