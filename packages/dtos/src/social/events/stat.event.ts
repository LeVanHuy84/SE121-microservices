import { EventTopic } from './event.enum';

export enum StatsEventType {
  REACTION = 'stats.reaction',
  COMMENT = 'stats.comment',
  SHARE = 'stats.share',
}

export interface StatsDelta {
  [StatsEventType.REACTION]?: number;
  //[StatsEventType.VIEW]?: number;
  [StatsEventType.COMMENT]?: number;
  [StatsEventType.SHARE]?: number;
  // hoặc nếu bạn có field động hơn:
  [key: string]: number | undefined;
}

export interface StatsRecord {
  postId: string;
  deltas: StatsDelta;
}

export type StatPayload = {
  timestamp: number;
  payload: StatsRecord[];
};
