import { ReactionType, TargetType } from '../enums';
import { EventTopic } from './event.enum';

export enum StatsEventType {
  REACTION = 'stats.reaction',
  COMMENT = 'stats.comment',
  SHARE = 'stats.share',
}

export interface StatsReactionDelta {
  type: StatsEventType.REACTION;
  reactionType: ReactionType;
  delta: number;
}

export interface StatsCommentDelta {
  type: StatsEventType.COMMENT;
  delta: number;
}

export interface StatsShareDelta {
  type: StatsEventType.SHARE;
  delta: number;
}

export type StatsDeltaUnion =
  | StatsReactionDelta
  | StatsCommentDelta
  | StatsShareDelta;

export interface StatsRecord {
  targetType: TargetType;
  targetId: string;
  deltas: StatsDeltaUnion[];
  isTrendingCandidate: boolean;
}

export interface StatsPayload {
  timestamp: number;
  stats: StatsRecord[];
}

export type StatsEvent = {
  topic: EventTopic.STATS;
  type: 'stats.batch';
  payload: StatsPayload;
};
