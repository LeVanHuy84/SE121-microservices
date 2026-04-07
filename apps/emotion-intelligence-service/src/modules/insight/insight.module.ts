import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  EmotionAnalyticsSnapshot,
  EmotionAnalyticsSnapshotSchema,
} from 'src/mongo/schema/analytic-snapshot.schema';
import {
  UserEmotionProfile,
  UserEmotionProfileSchema,
} from 'src/mongo/schema/emotion-profile.schema';
import { EmotionFeatureController } from './emotion-feature/emotion-feature.controller';
import { EmotionFeatureRepository } from './emotion-feature/emotion-feature.repository';
import { EmotionFeatureService } from './emotion-feature/emotion-feature.service';
import { HighRiskRule } from './rules/high-risk.rule';
import { NegativeStreakRule } from './rules/negative-streak.rule';
import { HighNegativityRule } from './rules/high-negativity.rule';
import { DeterioratingTrendRule } from './rules/deteriorating-trend.rule';
import { RecoveringTrendRule } from './rules/recovering-trend.rule';
import { HighVolatilityRule } from './rules/high-volatility.rule';
import { PositiveStateRule } from './rules/positive-state.rule';
import { StableStateRule } from './rules/stable-state.rule';
import { AboveBaselineRule } from './rules/above-baseline.rule';
import { NormalizingRule } from './rules/normalizing.rule';
import { InsightEngine } from './insight.engine';
import { InsightFacade } from './insight.facade';
import { INSIGHT_RULES, InsightRule } from './insight.types';

const insightRuleProviders = [
  HighRiskRule,
  NegativeStreakRule,
  HighNegativityRule,
  DeterioratingTrendRule,
  RecoveringTrendRule,
  HighVolatilityRule,
  PositiveStateRule,
  StableStateRule,
  AboveBaselineRule,
  NormalizingRule,
];

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: UserEmotionProfile.name,
        schema: UserEmotionProfileSchema,
      },
      {
        name: EmotionAnalyticsSnapshot.name,
        schema: EmotionAnalyticsSnapshotSchema,
      },
    ]),
  ],
  controllers: [EmotionFeatureController],
  providers: [
    EmotionFeatureRepository,
    EmotionFeatureService,
    InsightEngine,
    InsightFacade,
    ...insightRuleProviders,
    {
      provide: INSIGHT_RULES,
      useFactory: (...rules: InsightRule[]) => rules,
      inject: insightRuleProviders,
    },
  ],
  exports: [InsightFacade],
})
export class InsightModule {}
