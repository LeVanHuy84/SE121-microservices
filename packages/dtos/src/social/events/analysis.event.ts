import { DominantModality, IntensityLevel } from '../../emotion/enums';
import { Emotion, Severity, TargetType } from '../enums';

export enum AnalysisEventType {
  CREATED = 'analysis_created',
  UPDATED = 'analysis_updated',
  EMOTION_RESULT = 'emotion_result',
  MODERATION_REJECTED = 'moderation_rejected',
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
  userId: string;
  targetId: string;
  targetType: TargetType;

  modelVersion: string;

  finalEmotion: Emotion;

  scores: Record<string, number>;
  confidence: number;
  intensityScore: number;
  intensityLevel?: IntensityLevel;

  dominantSceneType?: string;
  riskHintLevel?: string;
  createdAt?: Date;
}

export class ModerationEventPayload {
  targetId: string;
  targetType: TargetType;
  userId: string;
  violations: {
    type: string;
    category: string;
    severity: Severity;
    confidence: number;
    reason: string;
  };
  maxSeverity: string;
  confidence: number;
  displayMessage: string;
  createdAt?: Date;
}

export class AnalysisResultEvent {
  type: string;
  payload: AnalysisResultEventPayload;
}

export class ModerationRejectedEvent {
  type: string;
  payload: ModerationEventPayload;
}
