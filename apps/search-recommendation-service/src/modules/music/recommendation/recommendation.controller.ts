import { Controller } from '@nestjs/common';
import { RecommendationService } from './services/recommendation.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { MusicFeatureResponse, PageResponse, PaginationDTO } from '@repo/dtos';

@Controller('music-recommendations')
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  @MessagePattern('get_music_recommendations')
  getRecommendations(
    @Payload() payload: { userId: string; query: PaginationDTO },
  ): Promise<PageResponse<MusicFeatureResponse>> {
    const { userId, query } = payload;
    return this.recommendationService.getRecommendations(userId, query);
  }
}
