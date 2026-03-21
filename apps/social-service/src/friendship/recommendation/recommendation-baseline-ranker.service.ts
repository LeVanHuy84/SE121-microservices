import { Injectable } from '@nestjs/common';
import type { FriendRecommendation } from '../repositories/social-graph.repository';
import { RecommendationFeatureService } from './recommendation-feature.service';
import type { FeatureScoredRecommendation } from './recommendation.types';

@Injectable()
export class RecommendationBaselineRankerService {
  constructor(
    private readonly recommendationFeatureService: RecommendationFeatureService,
  ) {}

  buildRecommendation(
    candidate: FriendRecommendation,
    commonGroups: number,
    interactionScore = 0,
  ): FeatureScoredRecommendation {
    const featureVector =
      this.recommendationFeatureService.buildFeatureVector(
        candidate,
        commonGroups,
        interactionScore,
      );
    const score = Number(
      (
        0.5 * featureVector.mutualFriendScore +
        0.3 * featureVector.interactionScore +
        0.2 * featureVector.similarityScore
      ).toFixed(6),
    );

    return {
      ...candidate,
      commonGroups,
      featureVector,
      baseScore: score,
      score,
      reasons: featureVector.reasons,
    };
  }

  compareRecommendations(
    left: FriendRecommendation,
    right: FriendRecommendation,
  ): number {
    if ((right.score ?? 0) !== (left.score ?? 0)) {
      return (right.score ?? 0) - (left.score ?? 0);
    }

    if (right.mutualFriends !== left.mutualFriends) {
      return right.mutualFriends - left.mutualFriends;
    }

    if ((right.commonGroups ?? 0) !== (left.commonGroups ?? 0)) {
      return (right.commonGroups ?? 0) - (left.commonGroups ?? 0);
    }

    return left.id.localeCompare(right.id);
  }
}
