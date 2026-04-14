export const SNAPSHOT_EMOTIONS = [
  'joy',
  'sadness',
  'anger',
  'fear',
  'disgust',
  'surprise',
  'neutral',
] as const;

export type SnapshotEmotion = (typeof SNAPSHOT_EMOTIONS)[number];

export type EmotionDistribution = Record<SnapshotEmotion, number>;

export interface SnapshotAggregateEvent {
  createdAt: Date;
  finalEmotion?: string;
  finalScores?: Record<string, number>;
}

export interface SnapshotPayload {
  userId: string;
  window: '1d' | '7d' | '30d';
  emotionDistribution: EmotionDistribution;
  negativeRatio: number;
  emotionVolatility: number;
  trend: number;
  baselineNegativeRatio: number;
  riskScore: number;
  createdAt: Date;
}
