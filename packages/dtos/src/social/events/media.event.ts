import { EventTopic } from './event.enum';
import { MediaType } from '../../common';

export enum MediaEventType {
  DELETE_REQUESTED = 'media.delete.requested',
  CONTENT_ID_ASSIGNED = 'media.content_id.assigned',
}

export type MediaDeleteItem = {
  publicId: string;
  resourceType?: 'image' | 'video' | 'raw';
};

export interface MediaEventPayloads {
  [MediaEventType.DELETE_REQUESTED]: {
    items: MediaDeleteItem[];
    source?: string;
    reason?: string;
  };
  [MediaEventType.CONTENT_ID_ASSIGNED]: {
    contentId: string;
    items: { publicId: string; url?: string; type?: MediaType }[];
    source?: string;
  };
}

export type MediaEvent<K extends MediaEventType> = {
  topic: EventTopic.MEDIA;
  type: K;
  payload: MediaEventPayloads[K];
};

export type MediaEventMessage =
  | MediaEvent<MediaEventType.DELETE_REQUESTED>
  | MediaEvent<MediaEventType.CONTENT_ID_ASSIGNED>;
