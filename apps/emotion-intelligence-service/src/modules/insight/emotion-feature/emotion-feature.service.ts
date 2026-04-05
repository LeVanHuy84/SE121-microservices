import { Injectable } from '@nestjs/common';
import { EmotionRankingFeaturesDto } from '@repo/dtos';
import { EmotionFeatureRepository } from './emotion-feature.repository';

const NEUTRAL_DISTRIBUTION: Record<string, number> = {
  joy: 0.1,
  sadness: 0.1,
  anger: 0.1,
  fear: 0.1,
  disgust: 0.1,
  surprise: 0.1,
  neutral: 0.4,
};

@Injectable()
export class EmotionFeatureService {
  constructor(private readonly repository: EmotionFeatureRepository) {}

  private toSafeNumber(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  async getUserEmotionFeatures(
    userId: string,
  ): Promise<EmotionRankingFeaturesDto> {
    // ===== PARALLEL FETCH =====
    const [profile, { snapshot1d, snapshot7d }] = await Promise.all([
      this.repository.findProfileByUserId(userId),
      this.repository.getLatestSnapshots(userId),
    ]);

    // ===== USER PREFERENCE =====
    const userEmotionPreference =
      profile?.emotionVectorEMA &&
      Object.keys(profile.emotionVectorEMA).length > 0
        ? profile.emotionVectorEMA
        : { ...NEUTRAL_DISTRIBUTION };

    // ===== SNAPSHOT-BASED FEATURES =====
    const last24hEmotionDistribution = snapshot1d?.emotionDistribution ?? {
      ...NEUTRAL_DISTRIBUTION,
    };

    const negativeRatio7d = this.toSafeNumber(snapshot7d?.negativeRatio);

    const emotionVolatility7d = this.toSafeNumber(
      snapshot7d?.emotionVolatility,
    );

    const riskScore = this.toSafeNumber(snapshot7d?.riskScore);

    // ===== PROFILE FEATURES =====
    const recentNegativityScore = this.toSafeNumber(
      profile?.recentNegativityScore,
    );

    const emotionMomentum = this.toSafeNumber(profile?.emotionMomentum);

    // ===== FINAL DTO =====
    return {
      userEmotionPreference,
      last24hEmotionDistribution,
      negativeRatio7d,
      emotionVolatility7d,
      riskScore,
      recentNegativityScore,
      emotionMomentum,
    };
  }
}
