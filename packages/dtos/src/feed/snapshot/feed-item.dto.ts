import { FeedEventType } from '../enums';
import { PostSnapshotDTO } from './post-snapshot.dto';
import { ShareSnapshotDTO } from './share-snapshot.dto';

export enum InterventionType {
  AI_CHATBOT_SAFE_SPACE = 'AI_CHATBOT_SAFE_SPACE',
}

export interface FeedInterventionDTO {
  id: string;
  type: InterventionType;
  title: string;
  description: string;
  buttonText: string;
}

export type FeedItemDTO = {
  id: string;
  type: FeedEventType;
  item?: PostSnapshotDTO | ShareSnapshotDTO;
  intervention?: FeedInterventionDTO;
};
