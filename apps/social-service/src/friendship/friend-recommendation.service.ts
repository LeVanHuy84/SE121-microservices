import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { CursorPaginationDTO, CursorPageResponse } from '@repo/dtos';
import {
  GroupClientService,
  GroupRecommendationCandidate,
} from '../client/group/group-client.service';
import { UserClientService } from '../client/user/user-client.service';
import {
  FriendRecommendation,
  SOCIAL_GRAPH_REPOSITORY,
} from './repositories/social-graph.repository';
import {
  FriendRecommendationScoringConfig,
  loadFriendRecommendationScoringConfig,
} from './friend-recommendation.config';
import type {
  FriendRecommendationAnalyticsSource,
  SocialGraphRepository,
} from './repositories/social-graph.repository';

@Injectable()
export class FriendRecommendationService {
  private readonly logger = new Logger(FriendRecommendationService.name);
  private readonly overscanMultiplier = 5;
  private readonly maxOverscan = 100;
  private readonly scoringConfig: FriendRecommendationScoringConfig;

  constructor(
    @Inject(SOCIAL_GRAPH_REPOSITORY)
    private readonly socialGraphRepo: SocialGraphRepository,
    private readonly groupClient: GroupClientService,
    private readonly userClient: UserClientService,
    configService: ConfigService,
  ) {
    this.scoringConfig = loadFriendRecommendationScoringConfig(configService);
  }

  async recommendFriends(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<FriendRecommendation>> {
    const requestedLimit = this.normalizeLimit(query.limit);
    const candidateLimit = query.cursor
      ? this.maxOverscan
      : Math.min(
          Math.max(requestedLimit * this.overscanMultiplier, requestedLimit),
          this.maxOverscan,
        );

    const graphCandidatePage = await this.socialGraphRepo.recommendFriends(userId, {
      ...query,
      cursor: undefined,
      limit: candidateLimit,
    });
    const groupCandidates = await this.groupClient.getGroupRecommendationCandidates(
      userId,
      candidateLimit,
    );

    const graphCandidatesById = new Map(
      graphCandidatePage.data.map((candidate) => [candidate.id, candidate]),
    );
    const groupOnlyCandidateIds = groupCandidates
      .map((candidate) => candidate.id)
      .filter((candidateId) => !graphCandidatesById.has(candidateId));
    const groupOnlyCandidates =
      await this.socialGraphRepo.summarizeCandidates(userId, groupOnlyCandidateIds);

    const mergedCandidates = [
      ...graphCandidatePage.data,
      ...groupOnlyCandidates,
    ];

    if (mergedCandidates.length === 0) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
      };
    }

    const commonGroupCountsByUser = await this.groupClient.getCommonGroupCounts(
      userId,
      mergedCandidates.map((candidate) => candidate.id),
    );
    this.mergeGroupCandidateScores(commonGroupCountsByUser, groupCandidates);

    const rankedCandidates = this.rerankForDiversity(
      mergedCandidates
      .map((candidate) =>
        this.buildRecommendation(
          candidate,
          commonGroupCountsByUser[candidate.id] ?? 0,
        ),
      )
      .sort((left, right) => this.compareRecommendations(left, right)),
    );

    const startIndex = this.resolveStartIndex(rankedCandidates, query.cursor);
    if (startIndex === null) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
      };
    }

    const visibleData = rankedCandidates.slice(
      startIndex,
      startIndex + requestedLimit,
    );
    const visibleRecommendations =
      this.attachRecommendationTrackingIds(visibleData);
    const hydratedVisibleData =
      await this.hydrateRecommendationUsers(visibleRecommendations);
    const nextIndex = startIndex + visibleData.length;
    const hasNextPage =
      nextIndex < rankedCandidates.length ||
      graphCandidatePage.hasNextPage ||
      groupCandidates.length >= candidateLimit;

    await this.socialGraphRepo.recordRecommendationEvents(
      hydratedVisibleData.map((recommendation, index) => ({
        userId,
        candidateId: recommendation.id,
        eventType: 'served',
        recommendationId: recommendation.recommendationId ?? null,
        recommendationRequestId: recommendation.recommendationRequestId ?? null,
        metadata: {
          mutualFriends: recommendation.mutualFriends,
          commonGroups: recommendation.commonGroups ?? 0,
          score: recommendation.score ?? 0,
          source: this.getRecommendationSource(recommendation),
          reasons: recommendation.reasons ?? [],
          position: startIndex + index,
        },
      })),
    );

    this.logger.debug(
      `Ranked ${rankedCandidates.length} friend candidates for user ${userId}`,
    );

    return {
      data: hydratedVisibleData,
      nextCursor:
        hasNextPage && hydratedVisibleData.length > 0
          ? hydratedVisibleData[hydratedVisibleData.length - 1].id
          : null,
      hasNextPage,
    };
  }

  private mergeGroupCandidateScores(
    commonGroupCountsByUser: Record<string, number>,
    groupCandidates: GroupRecommendationCandidate[],
  ) {
    for (const candidate of groupCandidates) {
      commonGroupCountsByUser[candidate.id] = Math.max(
        commonGroupCountsByUser[candidate.id] ?? 0,
        candidate.commonGroups,
      );
    }
  }

  private buildRecommendation(
    candidate: FriendRecommendation,
    commonGroups: number,
  ): FriendRecommendation {
    const mutualFriendContribution =
      Math.min(
        candidate.mutualFriends,
        this.scoringConfig.mutualFriendCap,
      ) * this.scoringConfig.mutualFriendWeight;
    const commonGroupContribution =
      Math.min(commonGroups, this.scoringConfig.commonGroupCap) *
      this.scoringConfig.commonGroupWeight;
    const score = mutualFriendContribution + commonGroupContribution;
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
      ...candidate,
      commonGroups,
      score,
      reasons,
    };
  }

  private normalizeLimit(limit: number | undefined): number {
    if (typeof limit !== 'number' || !Number.isFinite(limit)) {
      return 10;
    }

    return Math.max(1, Math.floor(limit));
  }

  private async hydrateRecommendationUsers(
    recommendations: FriendRecommendation[],
  ): Promise<FriendRecommendation[]> {
    if (recommendations.length === 0) {
      return recommendations;
    }

    const userIds = [
      ...new Set(
        recommendations.flatMap((recommendation) => [
          recommendation.id,
          ...recommendation.mutualFriendIds.slice(0, 3),
        ]),
      ),
    ];

    const usersById = await this.userClient.getUserInfos(userIds);

    return recommendations.map((recommendation) => ({
      ...recommendation,
      user: usersById[recommendation.id] ?? null,
      mutualFriendPreview: recommendation.mutualFriendIds
        .slice(0, 3)
        .map((mutualFriendId) => usersById[mutualFriendId])
        .filter((user): user is NonNullable<typeof user> => Boolean(user)),
    }));
  }

  private attachRecommendationTrackingIds(
    recommendations: FriendRecommendation[],
  ): FriendRecommendation[] {
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

  private rerankForDiversity(
    recommendations: FriendRecommendation[],
  ): FriendRecommendation[] {
    if (recommendations.length <= 1) {
      return recommendations;
    }

    const selected: FriendRecommendation[] = [];
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
          this.compareRecommendations(candidate, remaining[bestIndex]) < 0
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

    const candidateSource = this.getRecommendationSource(candidate);
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
        (this.getRecommendationSource(selected) === candidateSource
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

  private getRecommendationSource(
    recommendation: FriendRecommendation,
  ): FriendRecommendationAnalyticsSource {
    const hasMutualFriends = recommendation.mutualFriends > 0;
    const hasCommonGroups = (recommendation.commonGroups ?? 0) > 0;

    if (hasMutualFriends && hasCommonGroups) {
      return 'mixed';
    }
    if (hasMutualFriends) {
      return 'mutual_only';
    }
    if (hasCommonGroups) {
      return 'group_only';
    }

    return 'fallback';
  }

  private compareRecommendations(
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

  private resolveStartIndex(
    rankedCandidates: FriendRecommendation[],
    cursor: string | undefined,
  ): number | null {
    if (!cursor) {
      return 0;
    }

    const cursorIndex = rankedCandidates.findIndex(
      (candidate) => candidate.id === cursor,
    );

    return cursorIndex === -1 ? null : cursorIndex + 1;
  }
}
