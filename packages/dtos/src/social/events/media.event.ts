import { EventTopic } from './event.enum';

export enum MediaEventType {
  DELETE_REQUESTED = 'media.delete.requested',
}

export type MediaDeleteItem = {
  publicId: string;
  resourceType?: 'image' | 'video';
};

export interface MediaEventPayloads {
  [MediaEventType.DELETE_REQUESTED]: {
    items: MediaDeleteItem[];
    source?: string;
    reason?: string;
  };
}

export type MediaEvent<K extends MediaEventType> = {
  topic: EventTopic.MEDIA;
  type: K;
  payload: MediaEventPayloads[K];
};

export type MediaEventMessage = MediaEvent<MediaEventType.DELETE_REQUESTED>;
