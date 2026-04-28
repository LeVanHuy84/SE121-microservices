import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { RecommendationController } from './recommendation.controller';
import { EmotionMappingService } from './services/emotion-mapping.service';
import { EmotionStateService } from './services/emotion-state.service';
import { RecommendationService } from './services/recommendation.service';

@Module({
  imports: [CatalogModule, DiscoveryModule],
  controllers: [RecommendationController],
  providers: [
    RecommendationService,
    EmotionMappingService,
    EmotionStateService,
  ],
  exports: [RecommendationService],
})
export class RecommendationModule {}
