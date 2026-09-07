import { Injectable } from '@nestjs/common';
import {
  EmotionRankingFeaturesDto,
  EmotionTimeWindow,
  RiskLevel,
  UserEmotionSignalDto,
} from '@repo/dtos';
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
      profile?.decayedNegativityScore,
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

  async getUserEmotionSignal(userId: string): Promise<UserEmotionSignalDto> {
    const [profile, snapshot1d, risk] = await Promise.all([
      this.repository.findProfileByUserId(userId),
      this.repository.getLatestSnapshot(userId, EmotionTimeWindow.ONE_DAY),
      this.repository.findRiskState(userId),
    ]);

    // ===== FALLBACKS =====
    const emotionVector =
      profile?.emotionVectorEMA &&
      Object.keys(profile.emotionVectorEMA).length > 0
        ? profile.emotionVectorEMA
        : { ...NEUTRAL_DISTRIBUTION };

    const negativity = this.toSafeNumber(profile?.decayedNegativityScore);

    const momentum = this.toSafeNumber(profile?.emotionMomentum);

    const volatility = this.toSafeNumber(snapshot1d?.emotionVolatility);

    const trend = this.toSafeNumber(snapshot1d?.trend);

    const riskScore =
      risk?.riskScore ?? this.toSafeNumber(snapshot1d?.riskScore);

    const riskLevel = risk?.riskLevel ?? this.deriveRiskLevel(riskScore);

    return {
      userId,
      emotionVector,

      negativity,
      volatility,
      trend,
      momentum,

      riskLevel,
      riskScore,

      window: EmotionTimeWindow.ONE_DAY,
      computedAt: new Date(),
    };
  }

  private deriveRiskLevel(score: number): RiskLevel {
    if (score >= 0.85) return RiskLevel.CRISIS;
    if (score >= 0.7) return RiskLevel.HIGH_RISK;
    if (score >= 0.5) return RiskLevel.MODERATE_RISK;
    if (score >= 0.3) return RiskLevel.MILD_STRESS;
    return RiskLevel.NORMAL;
  }
}
