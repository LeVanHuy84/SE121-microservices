import {
  CommentResponseDTO,
  Emotion,
  PostResponseDTO,
  TargetType,
} from '../social';
import { LowCaseEmotion, MentalHealthRiskLevel, RiskHintLevel } from './enums';

export class AnalysisSummaryDto {
  targetId: string;
  targetType: TargetType;

  finalEmotion: Emotion;
  primaryEmotion?: LowCaseEmotion | Emotion;
  secondaryEmotions?: LowCaseEmotion[] | Emotion[];
  finalScores: Record<LowCaseEmotion, number>;
  confidence: number;

  riskLevel: RiskHintLevel | MentalHealthRiskLevel | string;
  mentalHealthRiskLevel?: MentalHealthRiskLevel | string;
  isSarcasmOrConflict?: boolean;

  createdAt: Date;

  content: PostResponseDTO | CommentResponseDTO;
}
