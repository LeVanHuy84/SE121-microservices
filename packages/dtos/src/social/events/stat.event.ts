import { EventTopic } from './event.enum';

export enum StatsEventType {
  REACTION = 'stats.reaction',
  COMMENT = 'stats.comment',
  SHARE = 'stats.share',
}

export interface StatsEventPayloads {
  [StatsEventType.REACTION]: {
    postId: string;
    action: 'add' | 'remove';
  };
  [StatsEventType.COMMENT]: {
    postId: string;
    action: 'add' | 'remove';
  };
  [StatsEventType.SHARE]: {
    postId: string;
    action: 'add' | 'remove';
  };
}

export type StatsEvent<K extends StatsEventType> = {
  topic: EventTopic.STATS;
  type: K;
  payload: StatsEventPayloads[K];
};

export type StatsEventMessage =
  | StatsEvent<StatsEventType.REACTION>
  | StatsEvent<StatsEventType.COMMENT>
  | StatsEvent<StatsEventType.SHARE>;

export type InferStatsPayload<T extends StatsEventType> = StatsEventPayloads[T];
