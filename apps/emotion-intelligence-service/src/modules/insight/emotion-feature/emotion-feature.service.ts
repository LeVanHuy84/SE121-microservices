import { Injectable } from '@nestjs/common';
import {
  Aggregate24hProjection,
  EmotionFeatureRepository,
} from './emotion-feature.repository';
import { Emotion, EmotionRankingFeaturesDto } from '@repo/dtos';

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
    const profileDoc =
      await this.repository.findProfileWithSnapshotsByUserId(userId);

    const userEmotionPreference =
      profileDoc?.emotionVectorEMA &&
      Object.keys(profileDoc.emotionVectorEMA).length > 0
        ? profileDoc.emotionVectorEMA
        : { ...NEUTRAL_DISTRIBUTION };

    const recentNegativityScore = this.toSafeNumber(
      profileDoc?.recentNegativityScore,
    );
    const emotionMomentum = this.toSafeNumber(profileDoc?.emotionMomentum);
    const snapshot7d = profileDoc?.snapshot7d;

    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const aggregates24h = await this.repository.findAggregatesByUserIdInRange(
      userId,
      since24h,
      now,
    );
    const last24hEmotionDistribution =
      this.compute24hDistribution(aggregates24h);

    const features: EmotionRankingFeaturesDto = {
      userEmotionPreference,
      last24hEmotionDistribution,
      negativeRatio7d: this.toSafeNumber(snapshot7d?.negativeRatio),
      emotionVolatility7d: this.toSafeNumber(snapshot7d?.emotionVolatility),
      riskScore: this.toSafeNumber(snapshot7d?.riskScore),
      recentNegativityScore,
      emotionMomentum,
    };

    return features;
  }

  private compute24hDistribution(
    aggregates: Aggregate24hProjection[],
  ): Record<string, number> {
    if (aggregates.length === 0) {
      return { ...NEUTRAL_DISTRIBUTION };
    }

    const totals: Record<string, number> = {};

    for (const aggregate of aggregates) {
      const scores = aggregate.finalScores ?? {};
      for (const [emotion, scoreValue] of Object.entries(scores)) {
        const score = Number(scoreValue);
        if (!Number.isFinite(score)) {
          continue;
        }
        totals[emotion] = (totals[emotion] ?? 0) + score;
      }
    }

    const grandTotal = Object.values(totals).reduce(
      (sum, value) => sum + value,
      0,
    );

    if (grandTotal === 0) {
      return { ...NEUTRAL_DISTRIBUTION };
    }

    const distribution: Record<string, number> = {};
    for (const [emotion, total] of Object.entries(totals)) {
      distribution[emotion] = total / grandTotal;
    }

    return distribution;
  }
}
