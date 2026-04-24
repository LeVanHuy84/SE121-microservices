import { EmotionTimeWindow, RiskLevel } from './enums';

export class UserEmotionSignalDto {
  userId: string;

  emotionVector: Record<string, number>;

  negativity: number;
  volatility: number;
  trend: number;
  momentum: number;

  riskLevel: RiskLevel;
  riskScore: number;

  window: EmotionTimeWindow.ONE_DAY;
  computedAt: Date;
}
