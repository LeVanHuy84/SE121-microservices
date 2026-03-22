import { Inject, Injectable } from '@nestjs/common';
import { GroupClientService } from '../../client/group/group-client.service';
import { UserClientService } from '../../client/user/user-client.service';
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
    private readonly userClient: UserClientService,
  ) {}

  async loadCandidateBundle(
    userId: string,
    candidateLimit: number,
    options?: {
      graphCursor?: string | null;
      includeGroupCandidates?: boolean;
      includeProfileCandidates?: boolean;
    },
  ): Promise<RecommendationCandidateBundle> {
    const graphCursor = options?.graphCursor ?? undefined;
    const includeGroupCandidates = options?.includeGroupCandidates ?? !graphCursor;
    const includeProfileCandidates =
      options?.includeProfileCandidates ?? !graphCursor;
    const [graphCandidatePage, groupCandidates, profileCandidates] = await Promise.all([
      this.socialGraphRepo.recommendFriends(userId, {
        cursor: graphCursor,
        limit: candidateLimit,
      }),
      includeGroupCandidates
        ? this.groupClient.getGroupRecommendationCandidates(userId, candidateLimit)
        : Promise.resolve([]),
      includeProfileCandidates
        ? this.userClient.getProfileRecommendationCandidates(userId, candidateLimit)
        : Promise.resolve([]),
    ]);

    const graphCandidatesById = new Map(
      graphCandidatePage.data.map((candidate) => [candidate.id, candidate]),
    );
    const groupCandidatesById = new Map(
      groupCandidates.map((candidate) => [candidate.id, candidate]),
    );
    const groupOnlyCandidateIds = groupCandidates
      .map((candidate) => candidate.id)
      .filter((candidateId) => !graphCandidatesById.has(candidateId));
    const profileCandidatesById = new Map(
      profileCandidates.map((candidate) => [candidate.id, candidate]),
    );
    const profileOnlyCandidateIds = profileCandidates
      .map((candidate) => candidate.id)
      .filter(
        (candidateId) =>
          !graphCandidatesById.has(candidateId) &&
          !groupCandidatesById.has(candidateId),
      );
    const [groupOnlyCandidates, profileOnlyCandidates] = await Promise.all([
      groupOnlyCandidateIds.length > 0
        ? this.socialGraphRepo.summarizeCandidates(userId, groupOnlyCandidateIds)
        : Promise.resolve([]),
      profileOnlyCandidateIds.length > 0
        ? this.socialGraphRepo.summarizeCandidates(userId, profileOnlyCandidateIds)
        : Promise.resolve([]),
    ]);

    const mergedCandidates = [
      ...graphCandidatePage.data.map((candidate) =>
        this.applyProfileMatch(candidate, profileCandidatesById.get(candidate.id)),
      ),
      ...groupOnlyCandidates.map((candidate) =>
        this.applyProfileMatch(candidate, profileCandidatesById.get(candidate.id)),
      ),
      ...profileOnlyCandidates.map((candidate) =>
        this.applyProfileMatch(candidate, profileCandidatesById.get(candidate.id)),
      ),
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
      graphNextCursor: graphCandidatePage.hasNextPage
        ? graphCandidatePage.nextCursor
        : null,
      candidateLimit,
      mergedCandidates,
      groupCandidates,
      commonGroupCountsByUser,
    };
  }

  private applyProfileMatch(
    candidate: RecommendationCandidateBundle['mergedCandidates'][number],
    profileCandidate:
      | {
          profileMatchScore: number;
          matchedSignals?: string[];
          sharedInterestsCount?: number;
        }
      | undefined,
  ) {
    if (!profileCandidate) {
      return candidate;
    }

    return {
      ...candidate,
      profileMatchScore: profileCandidate.profileMatchScore,
      profileMatchedSignals: profileCandidate.matchedSignals ?? [],
      sharedInterestsCount: profileCandidate.sharedInterestsCount ?? 0,
    };
  }
}
