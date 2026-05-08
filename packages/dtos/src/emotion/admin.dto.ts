import { IsOptional, IsEnum, IsNumber } from 'class-validator';
import { RiskLevel } from './enums';

export class DashboardOverviewResponseDto {
  totalAnalyzedSnapshots: number;
  highRiskUsers: number;
  criticalRiskUsers: number;
  averageNegativityScore: number;
  topEmotions: Record<string, number>;
}

export class RiskUsersQueryDto {
  @IsOptional()
  @IsNumber()
  page?: number;

  @IsOptional()
  @IsNumber()
  limit?: number;

  @IsOptional()
  @IsEnum(RiskLevel)
  riskLevel?: RiskLevel;
}

export class RiskUserItemDto {
  userId: string;
  riskLevel: RiskLevel;
  riskScore: number;
  signalCount: number;
  updatedAt?: Date;
  flagged?: boolean;
}

// Profile detail and snapshot timeline DTOs removed for privacy.

export class FeedbackListQueryDto {
  @IsOptional()
  @IsNumber()
  page?: number;

  @IsOptional()
  @IsNumber()
  limit?: number;

  @IsOptional()
  isAccurate?: boolean;
}

export class FeedbackListItemDto {
  predictedEmotion: string;
  expectedEmotion?: string;
  isAccurate: boolean;
  modelVersion?: string;
  createdAt: Date;
}

export class MismatchPairDto {
  predicted: string;
  expected: string;
  count: number;
}

export class FeedbackAccuracySummaryDto {
  totalFeedbacks: number;
  accurateCount: number;
  inaccurateCount: number;
  accuracyRate: number;
  topMismatchPairs: MismatchPairDto[];
}
