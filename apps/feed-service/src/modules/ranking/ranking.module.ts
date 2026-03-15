import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RankingService } from './services/ranking.service';
import { UserAffinityService } from './services/user-affinity.service';
import { EmotionFeatureService } from './services/emotion-feature.service';
import { UserFilterService } from './services/user-filter.service';
import { TrendingRankingStrategy } from './strategies/trending-ranking.strategy';
import { PersonalRankingStrategy } from './strategies/personal-ranking.strategy';

/**
 * RankingModule - Module quản lý ranking logic
 *
 * Exports:
 * - RankingService: orchestrator cho trending & personal ranking
 * - UserAffinityService: quản lý user emotion affinity
 * - EmotionFeatureService: fetch emotion features từ analysis-service
 */
@Module({
  imports: [ConfigModule],
  providers: [
    // Main orchestrator
    RankingService,

    // Services
    UserAffinityService,
    EmotionFeatureService,
    UserFilterService,

    // Strategies
    TrendingRankingStrategy,
    PersonalRankingStrategy,
  ],
  exports: [RankingService, UserAffinityService, EmotionFeatureService],
})
export class RankingModule {}
