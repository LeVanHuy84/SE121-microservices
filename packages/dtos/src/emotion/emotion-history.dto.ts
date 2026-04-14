import { Emotion, TargetType } from '../social';
import { RiskHintLevel } from './enums';

export class EmotionHistoryItemDto {
  targetId: string;
  targetType: TargetType;
  finalEmotion: Emotion;
  finalConfidence: number;
  riskHintLevel: RiskHintLevel;
  createdAt: Date;
}
