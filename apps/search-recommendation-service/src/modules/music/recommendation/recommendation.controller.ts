import { TcpMessagePattern } from '@repo/common';
import { Controller } from '@nestjs/common';
import { RecommendationService } from './services/recommendation.service';
import { Payload } from '@nestjs/microservices';
import {
  MusicFeatureResponse,
  PageResponse,
  PaginationDTO,
  RiskLevel,
} from '@repo/dtos';

@Controller('music-recommendations')
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  @TcpMessagePattern('get_music_recommendations')
  getRecommendations(
    @Payload() payload: { userId: string; query: PaginationDTO },
  ): Promise<PageResponse<MusicFeatureResponse>> {
    const { userId, query } = payload;
    return this.recommendationService.getRecommendations(userId, query);
  }

  @TcpMessagePattern('get_music_recommendations_by_signal')
  getRecommendationsBySignal(
    @Payload()
    payload: {
      emotionVector?: Record<string, number>;
      riskLevel?: RiskLevel;
      query: PaginationDTO;
    },
  ): Promise<PageResponse<MusicFeatureResponse>> {
    const { emotionVector, riskLevel, query } = payload;
    return this.recommendationService.getRecommendationsBySignal(
      { emotionVector, riskLevel },
      query,
    );
  }
}
