import { Module } from '@nestjs/common';
import { CatalogModule } from './catalog/catalog.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { RecommendationModule } from './recommendation/recommendation.module';

@Module({
  imports: [CatalogModule, DiscoveryModule, RecommendationModule],
  exports: [CatalogModule, DiscoveryModule, RecommendationModule],
})
export class MusicModule {}
