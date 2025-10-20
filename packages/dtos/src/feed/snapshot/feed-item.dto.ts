import { FeedEventType } from '../enums';
import { PostSnapshotDTO } from './post-snapshot.dto';
import { ShareSnapshotDTO } from './share-snapshot.dto';

export type FeedItemDTO = {
  id: string;
  type: FeedEventType;
  item: PostSnapshotDTO | ShareSnapshotDTO;
};
