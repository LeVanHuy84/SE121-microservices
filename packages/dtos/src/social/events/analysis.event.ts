import { DominantModality, IntensityLevel } from '../../emotion/enums';
import { Emotion, TargetType } from '../enums';

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

  finalEmotion: Emotion;

  scores: Record<string, number>; // ✅ full distribution
  confidence: number; // ✅ finalConfidence
  intensityScore: number; // ✅ intensity.score
  intensityLevel?: IntensityLevel; // ✅ intensity.level (optional)

  dominantSceneType?: string;
  riskHintLevel?: string;
  createdAt?: Date;
}

export class ModerationEventPayload {
  targetId: string;
  targetType: TargetType;
}

export class AnalysisResultEvent {
  type: string;
  payload: AnalysisResultEventPayload;
}

export class ModerationRejectedEvent {
  type: string;
  payload: ModerationEventPayload;
}
