import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  FriendRecommendation,
  SOCIAL_GRAPH_REPOSITORY,
} from '../repositories/social-graph.repository';
import type { SocialGraphRepository } from '../repositories/social-graph.repository';
import {
  getRecommendationSource,
  type RecommendationFeatureVector,
} from './recommendation.types';

type TrackableRecommendation = FriendRecommendation & {
  featureVector?: RecommendationFeatureVector;
};

@Injectable()
export class RecommendationTrackingService {
  constructor(
    @Inject(SOCIAL_GRAPH_REPOSITORY)
    private readonly socialGraphRepo: SocialGraphRepository,
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
          groupAffinityScore:
            recommendation.featureVector?.groupAffinityScore ?? null,
          profileAffinityScore:
            recommendation.featureVector?.profileAffinityScore ?? null,
          semanticAffinityScore:
            recommendation.featureVector?.semanticAffinityScore ??
            recommendation.semanticMatchScore ??
            null,
          candidateSourceMode:
            recommendation.featureVector?.candidateSourceMode ??
            recommendation.candidateSourceMode ??
            'online',
          profileMatchedSignals: recommendation.profileMatchedSignals ?? [],
          sharedInterestsCount: recommendation.sharedInterestsCount ?? 0,
          baseScore: recommendation.baseScore ?? recommendation.score ?? 0,
          modelScore: recommendation.modelScore ?? null,
          score: recommendation.score ?? 0,
          source:
            recommendation.featureVector?.source ??
            getRecommendationSource(
              recommendation.mutualFriends,
              recommendation.commonGroups ?? 0,
              recommendation.profileMatchScore ?? 0,
              recommendation.semanticMatchScore ?? 0,
            ),
          reasons: recommendation.reasons ?? [],
          position: startIndex + index,
        },
      })),
    );
  }
}
