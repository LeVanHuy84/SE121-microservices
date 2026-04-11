import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FriendRecommendationScoringConfig,
  loadFriendRecommendationScoringConfig,
} from '../friend-recommendation.config';
import type { FriendRecommendation } from '../repositories/social-graph.repository';
import {
  getRecommendationSource,
  type RecommendationFeatureVector,
} from './recommendation.types';

@Injectable()
export class RecommendationFeatureService {
  private readonly scoringConfig: FriendRecommendationScoringConfig;

  constructor(configService: ConfigService) {
    this.scoringConfig = loadFriendRecommendationScoringConfig(configService);
  }

  buildFeatureVector(
    candidate: FriendRecommendation,
    commonGroups: number,
  ): RecommendationFeatureVector {
    const mutualFriendScore = this.normalizeCount(
      candidate.mutualFriends,
      this.scoringConfig.mutualFriendCap,
    );
    const commonGroupScore = this.normalizeCount(
      commonGroups,
      this.scoringConfig.commonGroupCap,
    );
    const groupAffinityScore = commonGroupScore;
    const profileAffinityScore = this.clampScore(candidate.profileMatchScore ?? 0);
    const semanticAffinityScore = this.clampScore(candidate.semanticMatchScore ?? 0);
    const reasons: string[] = [];

    if (candidate.mutualFriends > 0) {
      reasons.push(
        `${candidate.mutualFriends} mutual friend${candidate.mutualFriends === 1 ? '' : 's'}`,
      );
    }

    if (commonGroups > 0) {
      reasons.push(
        `${commonGroups} common group${commonGroups === 1 ? '' : 's'}`,
      );
    }

    if ((candidate.profileMatchedSignals?.length ?? 0) > 0) {
      reasons.push(
        `Similar profile: ${candidate.profileMatchedSignals?.join(', ')}`,
      );
    }

    if (semanticAffinityScore > 0) {
      reasons.push('Strong semantic profile match');
    }

    if (reasons.length === 0) {
      reasons.push('Suggested for you');
    }

    return {
      candidateId: candidate.id,
      mutualFriendsCount: candidate.mutualFriends,
      mutualFriendScore,
      commonGroupsCount: commonGroups,
      commonGroupScore,
      groupAffinityScore,
      profileAffinityScore,
      semanticAffinityScore,
      candidateSourceMode: candidate.candidateSourceMode ?? 'online',
      source: getRecommendationSource(
        candidate.mutualFriends,
        commonGroups,
        profileAffinityScore,
        semanticAffinityScore,
      ),
      reasons,
    };
  }

  private normalizeCount(value: number, cap: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }

    const safeCap = Number.isFinite(cap) && cap > 0 ? cap : 1;
    return Number(Math.min(value, safeCap) / safeCap);
  }

  private clampScore(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Number(Math.max(0, Math.min(1, value)).toFixed(6));
  }
}
