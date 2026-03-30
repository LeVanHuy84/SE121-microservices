import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmotionFeatureService } from './services/emotion-feature.service';
import { AffinityModule } from '../affinity/affinity.module';
import { ScoreCombinerService } from './services/score-combiner.service';

/**
 * RankingModule - Module quản lý ranking logic
 *
 * Exports:
 * - RankingService: orchestrator cho trending & personal ranking
 * - UserAffinityService: quản lý user emotion affinity
 * - EmotionFeatureService: fetch emotion features từ analysis-service
 */
@Module({
  imports: [ConfigModule, AffinityModule],
  providers: [
    // Services
    EmotionFeatureService,
    ScoreCombinerService,
  ],
  exports: [EmotionFeatureService, ScoreCombinerService],
})
export class RankingModule {}
