import { TargetType } from '../enums';

export enum AnalysisEventType {
  CREATED = 'analysis_created',
  UPDATED = 'analysis_updated',
}

export class CreatedAnalysisEventPayload {
  userId: string;
  targetId: string;
  targetType: TargetType;
  content: string;
  imageUrls: string[];
}

export class UpdatedAnalysisEventPayload {
  targetId: string;
  targetType: TargetType;
  content: string;
}

export class AnalysisResultEventPayload {
  targetId: string;
  targetType: TargetType;
  finalEmotion: string;
  finalScores: number;
}

export class AnalysisResultEvent {
  type: AnalysisEventType;
  payload: AnalysisResultEventPayload;
}
