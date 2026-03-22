import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RecentActivityBufferService } from '../../event/recent-activity.buffer.service';
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

  constructor(
    configService: ConfigService,
    private readonly recentActivityBuffer: RecentActivityBufferService,
  ) {
    this.scoringConfig = loadFriendRecommendationScoringConfig(configService);
  }

  async getInteractionScores(
    userId: string,
    candidateIds: string[],
  ): Promise<Record<string, number>> {
    return this.recentActivityBuffer.getRecentInteractionScores(
      userId,
      candidateIds,
    );
  }

  buildFeatureVector(
    candidate: FriendRecommendation,
    commonGroups: number,
    interactionScore = 0,
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

    if (reasons.length === 0) {
      reasons.push('Suggested for you');
    }

    return {
      candidateId: candidate.id,
      mutualFriendsCount: candidate.mutualFriends,
      mutualFriendScore,
      commonGroupsCount: commonGroups,
      commonGroupScore,
      interactionScore: this.clampScore(interactionScore),
      groupAffinityScore,
      source: getRecommendationSource(candidate.mutualFriends, commonGroups),
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
