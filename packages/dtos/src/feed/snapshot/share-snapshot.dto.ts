import { Expose, Type } from 'class-transformer';
import { PostSnapshotDTO } from './post-snapshot.dto';

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
}
