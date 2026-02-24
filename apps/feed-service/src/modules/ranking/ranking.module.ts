import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { RankingService } from './services/ranking.service';
import { UserAffinityService } from './services/user-affinity.service';
import { EmotionProfileService } from './services/emotion-profile.service';
import { UserFilterService } from './services/user-filter.service';
import { TrendingRankingStrategy } from './strategies/trending-ranking.strategy';
import { PersonalRankingStrategy } from './strategies/personal-ranking.strategy';
import { MICROSERVICE_CLIENT } from 'src/constants';

/**
 * RankingModule - Module quản lý ranking logic
 *
 * Exports:
 * - RankingService: orchestrator cho trending & personal ranking
 * - UserAffinityService: quản lý user emotion affinity
 * - EmotionProfileService: fetch emotion profile/preference từ analysis-service
 */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: MICROSERVICE_CLIENT.ANALYSIS_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: configService.get<string>(
              'ANALYSIS_SERVICE_HOST',
              'localhost',
            ),
            port: configService.get<number>('ANALYSIS_SERVICE_PORT', 4010),
          },
        }),
      },
    ]),
  ],
  providers: [
    // Main orchestrator
    RankingService,

    // Services
    UserAffinityService,
    EmotionProfileService,
    UserFilterService,

    // Strategies
    TrendingRankingStrategy,
    PersonalRankingStrategy,
  ],
  exports: [RankingService, UserAffinityService, EmotionProfileService],
})
export class RankingModule {}
