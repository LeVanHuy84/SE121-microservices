import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FriendRecommendationScoringConfig, loadFriendRecommendationScoringConfig } from '../friend-recommendation.config';
import type { FriendRecommendation } from '../repositories/social-graph.repository';
import { RecommendationBaselineRankerService } from './recommendation-baseline-ranker.service';
import { getRecommendationSource } from './recommendation.types';

@Injectable()
export class RecommendationDiversityService {
  private readonly scoringConfig: FriendRecommendationScoringConfig;

  constructor(
    configService: ConfigService,
    private readonly baselineRanker: RecommendationBaselineRankerService,
  ) {
    this.scoringConfig = loadFriendRecommendationScoringConfig(configService);
  }

  rerank<T extends FriendRecommendation>(recommendations: T[]): T[] {
    if (recommendations.length <= 1) {
      return recommendations;
    }

    const selected: T[] = [];
    const remaining = [...recommendations];

    while (remaining.length > 0) {
      const recentSelections = selected.slice(
        Math.max(0, selected.length - this.scoringConfig.diversityWindowSize),
      );

      let bestIndex = 0;
      let bestAdjustedScore = Number.NEGATIVE_INFINITY;

      for (let index = 0; index < remaining.length; index += 1) {
        const candidate = remaining[index];
        const adjustedScore = this.getDiversityAdjustedScore(
          candidate,
          recentSelections,
        );

        if (adjustedScore > bestAdjustedScore) {
          bestAdjustedScore = adjustedScore;
          bestIndex = index;
          continue;
        }

        if (
          adjustedScore === bestAdjustedScore &&
          this.baselineRanker.compareRecommendations(
            candidate,
            remaining[bestIndex],
          ) < 0
        ) {
          bestIndex = index;
        }
      }

      selected.push(remaining[bestIndex]);
      remaining.splice(bestIndex, 1);
    }

    return selected;
  }

  private getDiversityAdjustedScore(
    candidate: FriendRecommendation,
    recentSelections: FriendRecommendation[],
  ): number {
    const baseScore = candidate.score ?? 0;
    if (recentSelections.length === 0) {
      return baseScore;
    }

    const candidateSource = getRecommendationSource(
      candidate.mutualFriends,
      candidate.commonGroups ?? 0,
    );
    const overlapPenalty = recentSelections.reduce((sum, selected) => {
      return (
        sum +
        this.countSharedMutualFriends(candidate, selected) *
          this.scoringConfig.sharedMutualFriendPenalty
      );
    }, 0);
    const repeatSourcePenalty = recentSelections.reduce((sum, selected) => {
      return (
        sum +
        (getRecommendationSource(
          selected.mutualFriends,
          selected.commonGroups ?? 0,
        ) === candidateSource
          ? this.scoringConfig.sourceRepeatPenalty
          : 0)
      );
    }, 0);

    return baseScore - overlapPenalty - repeatSourcePenalty;
  }

  private countSharedMutualFriends(
    left: FriendRecommendation,
    right: FriendRecommendation,
  ): number {
    if (left.mutualFriendIds.length === 0 || right.mutualFriendIds.length === 0) {
      return 0;
    }

    const rightIds = new Set(right.mutualFriendIds);
    return left.mutualFriendIds.reduce((count, id) => {
      return count + (rightIds.has(id) ? 1 : 0);
    }, 0);
  }
}
