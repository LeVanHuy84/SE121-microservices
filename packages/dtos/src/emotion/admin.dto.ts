import { IsOptional, IsNumber } from 'class-validator';

export class EmotionDistributionDto {
  joy: number;
  sadness: number;
  anger: number;
  fear: number;
  disgust: number;
  surprise: number;
  neutral: number;
  total: number;
}

export class RiskLevelDistributionDto {
  normal: number;
  low: number;
  medium: number;
  high: number;
  critical: number;
  totalUsers: number;
}

export class TargetTypeBreakdownDto {
  posts: number;
  comments: number;
  total: number;
}

export class ResourceSummaryDto {
  totalHotlines: number;
  activeHotlines: number;
  totalExercises: number;
  activeExercises: number;
}

export class DashboardOverviewResponseDto {
  totalAnalyzedSnapshots: number;
  totalInterventionsDispatched: number;
  activeInterventionResources: number;
  feedbackRate: number;
  aiAccuracyRate?: number;

  daysWindow: number;
  emotionDistribution: EmotionDistributionDto;
  riskDistribution: RiskLevelDistributionDto;
  targetTypeDistribution: TargetTypeBreakdownDto;
  resourceSummary: ResourceSummaryDto;
}

export class EmotionDashboardChartItemDto {
  date: string;

  joy: number;
  happy?: number;
  sadness: number;
  sad?: number;
  anger: number;
  angry?: number;
  fear: number;
  disgust: number;
  surprise: number;
  neutral: number;
}

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
