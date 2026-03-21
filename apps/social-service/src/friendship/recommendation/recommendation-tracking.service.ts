import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  FriendRecommendation,
  SOCIAL_GRAPH_REPOSITORY,
} from '../repositories/social-graph.repository';
import type { SocialGraphRepository } from '../repositories/social-graph.repository';
import { RecommendationDiversityService } from './recommendation-diversity.service';
import type { RecommendationFeatureVector } from './recommendation.types';

type TrackableRecommendation = FriendRecommendation & {
  featureVector?: RecommendationFeatureVector;
};

@Injectable()
export class RecommendationTrackingService {
  constructor(
    @Inject(SOCIAL_GRAPH_REPOSITORY)
    private readonly socialGraphRepo: SocialGraphRepository,
    private readonly diversityService: RecommendationDiversityService,
  ) {}

  attachRecommendationTrackingIds<T extends FriendRecommendation>(
    recommendations: T[],
  ): T[] {
    if (recommendations.length === 0) {
      return recommendations;
    }

    const recommendationRequestId = randomUUID();

    return recommendations.map((recommendation) => ({
      ...recommendation,
      recommendationId: randomUUID(),
      recommendationRequestId,
    }));
  }

  async recordServedEvents(
    userId: string,
    recommendations: TrackableRecommendation[],
    startIndex: number,
  ): Promise<void> {
    await this.socialGraphRepo.recordRecommendationEvents(
      recommendations.map((recommendation, index) => ({
        userId,
        candidateId: recommendation.id,
        eventType: 'served' as const,
        recommendationId: recommendation.recommendationId ?? null,
        recommendationRequestId: recommendation.recommendationRequestId ?? null,
        metadata: {
          mutualFriends: recommendation.mutualFriends,
          mutualFriendScore:
            recommendation.featureVector?.mutualFriendScore ?? null,
          commonGroups: recommendation.commonGroups ?? 0,
          interactionScore:
            recommendation.featureVector?.interactionScore ?? null,
          similarityScore:
            recommendation.featureVector?.similarityScore ?? null,
          baseScore: recommendation.baseScore ?? recommendation.score ?? 0,
          modelScore: recommendation.modelScore ?? null,
          score: recommendation.score ?? 0,
          source:
            recommendation.featureVector?.source ??
            this.diversityService.getRecommendationSource(recommendation),
          reasons: recommendation.reasons ?? [],
          position: startIndex + index,
        },
      })),
    );
  }
}
