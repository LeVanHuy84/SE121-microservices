import { Inject, Injectable, Logger } from '@nestjs/common';
import { CursorPaginationDTO, CursorPageResponse } from '@repo/dtos';
import {
  GroupClientService,
  GroupRecommendationCandidate,
} from '../client/group/group-client.service';
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
  ) {}

  async recommendFriends(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<FriendRecommendation>> {
    const requestedLimit = this.normalizeLimit(query.limit);
    const candidateLimit = Math.min(
      Math.max(requestedLimit * this.overscanMultiplier, requestedLimit),
      this.maxOverscan,
    );

    const graphCandidatePage = await this.socialGraphRepo.recommendFriends(userId, {
      ...query,
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

    const visibleData = rankedCandidates.slice(0, requestedLimit);
    const hasNextPage =
      graphCandidatePage.hasNextPage ||
      groupCandidates.length >= candidateLimit ||
      rankedCandidates.length > requestedLimit;

    this.logger.debug(
      `Ranked ${rankedCandidates.length} friend candidates for user ${userId}`,
    );

    return {
      data: visibleData,
      nextCursor:
        hasNextPage && visibleData.length > 0
          ? visibleData[visibleData.length - 1].id
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
}
