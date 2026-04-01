import { IsNotEmpty, IsString } from 'class-validator';

export class GetEmotionRankingFeaturesInputDto {
  @IsString()
  @IsNotEmpty()
  userId: string;
}

export class EmotionRankingFeaturesDto {
  userEmotionPreference: Record<string, number>;
  last24hEmotionDistribution: Record<string, number>;
  negativeRatio7d: number;
  emotionVolatility7d: number;
  riskScore: number;
  recentNegativityScore: number;
  emotionMomentum: number;
}
