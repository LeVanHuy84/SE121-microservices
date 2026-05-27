import { IsOptional, IsEnum, IsNumber } from 'class-validator';
import { RiskLevel } from './enums';
import { UserEmotionSignalDto } from './user-emotion-signal.dto';
import { BaseUserDTO } from '../user';

export class DashboardOverviewResponseDto {
  totalAnalyzedSnapshots: number;
  highRiskUsers: number;
  criticalRiskUsers: number;
  averageNegativityScore: number;
  topEmotions: Record<string, number>;
}

export class EmotionDashboardChartItemDto {
  date: string;

  angry: number;
  disgust: number;
  fear: number;
  happy: number;
  neutral: number;
  sad: number;
  surprise: number;
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

export class RiskUserDto {
  user: BaseUserDTO;
  riskItem: RiskUserItemDto;
}

export class RiskUserItemDto {
  userId: string;
  riskLevel: RiskLevel;
  riskScore: number;
  signalCount: number;
  updatedAt?: Date;
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
