import { Inject, Injectable, Logger } from '@nestjs/common';
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
import type { SocialGraphRepository } from './repositories/social-graph.repository';

@Injectable()
export class FriendRecommendationService {
  private readonly logger = new Logger(FriendRecommendationService.name);
  private readonly overscanMultiplier = 5;
  private readonly maxOverscan = 100;

  constructor(
    @Inject(SOCIAL_GRAPH_REPOSITORY)
    private readonly socialGraphRepo: SocialGraphRepository,
    private readonly groupClient: GroupClientService,
    private readonly userClient: UserClientService,
  ) {}

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

    const rankedCandidates = mergedCandidates
      .map((candidate) =>
        this.buildRecommendation(
          candidate,
          commonGroupCountsByUser[candidate.id] ?? 0,
        ),
      )
      .sort((left, right) => {
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
      });

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
    const hydratedVisibleData =
      await this.hydrateRecommendationUsers(visibleData);
    const nextIndex = startIndex + visibleData.length;
    const hasNextPage =
      nextIndex < rankedCandidates.length ||
      graphCandidatePage.hasNextPage ||
      groupCandidates.length >= candidateLimit;

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
    const score = candidate.mutualFriends * 10 + commonGroups * 6;
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
