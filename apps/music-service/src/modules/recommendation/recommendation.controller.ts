import { Controller, Get, Param } from '@nestjs/common';
import {
  RecommendationResult,
  RecommendationService,
} from './services/recommendation.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { PaginationDTO } from '@repo/dtos';

@Controller('recommendations')
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  @MessagePattern('get_music_recommendations')
  getRecommendations(
    @Payload() payload: { userId: string; query: PaginationDTO },
  ): Promise<RecommendationResult> {
    const { userId, query } = payload;
    return this.recommendationService.getRecommendations(userId, query);
  }
}
