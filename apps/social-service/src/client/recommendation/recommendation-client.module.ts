import { Module } from '@nestjs/common';
import { RecommendationClientService } from './recommendation-client.service';

@Module({
  providers: [RecommendationClientService],
  exports: [RecommendationClientService],
})
export class RecommendationClientModule {}
