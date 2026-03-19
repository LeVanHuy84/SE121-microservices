import { Inject, Injectable } from '@nestjs/common';
import { CursorPaginationDTO } from '@repo/dtos';
import { GroupClientService } from '../../client/group/group-client.service';
import {
  SOCIAL_GRAPH_REPOSITORY,
} from '../repositories/social-graph.repository';
import type { SocialGraphRepository } from '../repositories/social-graph.repository';
import { RecommendationCandidateBundle } from './recommendation.types';

@Injectable()
export class CandidateSourceService {
  constructor(
    @Inject(SOCIAL_GRAPH_REPOSITORY)
    private readonly socialGraphRepo: SocialGraphRepository,
    private readonly groupClient: GroupClientService,
  ) {}

  async loadCandidateBundle(
    userId: string,
    query: CursorPaginationDTO,
    candidateLimit: number,
  ): Promise<RecommendationCandidateBundle> {
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
    const commonGroupCountsByUser = await this.groupClient.getCommonGroupCounts(
      userId,
      mergedCandidates.map((candidate) => candidate.id),
    );

    for (const candidate of groupCandidates) {
      commonGroupCountsByUser[candidate.id] = Math.max(
        commonGroupCountsByUser[candidate.id] ?? 0,
        candidate.commonGroups,
      );
    }

    return {
      graphHasNextPage: graphCandidatePage.hasNextPage,
      candidateLimit,
      mergedCandidates,
      groupCandidates,
      commonGroupCountsByUser,
    };
  }
}
