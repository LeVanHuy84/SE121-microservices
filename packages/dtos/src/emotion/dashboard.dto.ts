import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { EmotionTimeWindow, InsightTone, InsightType } from './enums';

export class DashboardSummaryResponseDto {
  riskLevel: string;
  riskScore: number;

  recentNegativityScore: number;
  negativeEventStreak: number;
  emotionMomentum: number;

  lastEvaluatedAt?: Date;

  dominantEmotion?: string;
  shortTermTrend?: number;
  vsBaseline?: number;
}

export class GetDashboardTrendDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsEnum(EmotionTimeWindow)
  window: EmotionTimeWindow;
}

export class DashboardTrendPointDto {
  timestamp: Date;
  negativeRatio: number;
}

export class DashboardTrendResponseDto {
  data: DashboardTrendPointDto[];
  current: number;
  previous: number | null;
  trend: number;
  baseline: number;
}

export class GetDashboardDistributionDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsEnum(EmotionTimeWindow)
  window: EmotionTimeWindow;
}

export class DashboardDistributionResponseDto {
  distribution: Record<string, number>;
  dominantEmotion: string;
}

export class DashboardInsightItemDto {
  type: InsightType;
  message: string;
  tone: InsightTone;
}

export type DashboardInsightsResponseDto = DashboardInsightItemDto[];
