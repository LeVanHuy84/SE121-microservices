import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import {
  FriendRecommendation,
  SOCIAL_GRAPH_REPOSITORY,
} from "../repositories/social-graph.repository";
import type { SocialGraphRepository } from "../repositories/social-graph.repository";

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
    recommendations: FriendRecommendation[],
    startIndex: number,
  ): Promise<void> {
    await this.socialGraphRepo.recordRecommendationEvents(
      recommendations.map((recommendation, index) => {
        const sourceMode = recommendation.candidateSourceMode ?? "fallback";

        return {
          userId,
          candidateId: recommendation.id,
          eventType: "served" as const,
          recommendationId: recommendation.recommendationId ?? null,
          recommendationRequestId:
            recommendation.recommendationRequestId ?? null,
          metadata: {
            mutualFriends: recommendation.mutualFriends,
            commonGroups: recommendation.commonGroups ?? 0,
            candidateSourceMode: sourceMode,
            retrievalScore: recommendation.retrievalScore ?? null,
            retrievalScoreVersion: recommendation.retrievalScoreVersion ?? null,
            modelScore: recommendation.modelScore ?? null,
            score: recommendation.score ?? 0,
            source: sourceMode,
            reasons: recommendation.reasons ?? [],
            position: startIndex + index,
          },
        };
      }),
    );
  }
}
