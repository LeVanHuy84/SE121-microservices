import { Emotion, ModerationAction, ModerationLabel, Severity, TargetType } from '../enums';

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

export class ModerationEventPayload {
  targetId: string;
  targetType: TargetType;
  userId?: string;
  action?: ModerationAction;
  label?: ModerationLabel;
  isViolation?: boolean;
  mentalHealthSupport?: boolean;
  violations?: Array<{
    category: string;
    reason: string;
  }>;
  maxSeverity?: Severity | string;
  confidence?: number;
  displayMessage?: string;
  createdAt?: Date | string;
}

export class AnalysisResultEventPayload {
  userId: string;
  targetId: string;
  targetType: TargetType;

  content?: string;
  modelVersion: string;

  primaryEmotion?: Emotion;
  secondaryEmotions?: Emotion[];

  scores: Record<string, number>;
  confidence: number;

  isSarcasmOrConflict?: boolean;
  mentalHealthRiskLevel?: string;
  moderation?: ModerationEventPayload;

  createdAt?: Date;
}

export class AnalysisResultEvent {
  type: string;
  payload: AnalysisResultEventPayload;
}
