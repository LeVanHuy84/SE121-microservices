import { Emotion, TargetType } from '../social';
import { LowCaseEmotion, RiskHintLevel } from './enums';

export class AnalysisSummaryDto {
  targetId: string;
  targetType: TargetType;

  finalEmotion: Emotion;
  finalScores: Record<LowCaseEmotion, number>;
  confidence: number;

  riskLevel: RiskHintLevel;

  createdAt: Date;
}
