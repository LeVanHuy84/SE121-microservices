import { Inject, Injectable } from '@nestjs/common';
import { GroupClientService } from '../../client/group/group-client.service';
import { RecommendationPrecomputedCandidate } from '../../client/recommendation/recommendation-client.service';
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
      includeSemanticCandidates?: boolean;
    },
  ): Promise<RecommendationCandidateBundle> {
    const graphCursor = options?.graphCursor ?? undefined;
    const sourceMode = graphCursor ? 'graph_continuation' : 'online';
    const includeGroupCandidates = options?.includeGroupCandidates ?? !graphCursor;
    const includeProfileCandidates =
      options?.includeProfileCandidates ?? !graphCursor;
    const includeSemanticCandidates =
      options?.includeSemanticCandidates ?? !graphCursor;
    const [graphCandidatePage, groupCandidates, profileCandidates, semanticCandidates] =
      await Promise.all([
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
        includeSemanticCandidates
          ? this.userClient.getSemanticRecommendationCandidates(userId, candidateLimit)
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
    const semanticCandidatesById = new Map(
      semanticCandidates.map((candidate) => [candidate.id, candidate]),
    );
    const profileOnlyCandidateIds = profileCandidates
      .map((candidate) => candidate.id)
      .filter(
        (candidateId) =>
          !graphCandidatesById.has(candidateId) &&
          !groupCandidatesById.has(candidateId),
      );
    const semanticOnlyCandidateIds = semanticCandidates
      .map((candidate) => candidate.id)
      .filter(
        (candidateId) =>
          !graphCandidatesById.has(candidateId) &&
          !groupCandidatesById.has(candidateId) &&
          !profileCandidatesById.has(candidateId),
      );
    const [groupOnlyCandidates, profileOnlyCandidates, semanticOnlyCandidates] =
      await Promise.all([
      groupOnlyCandidateIds.length > 0
        ? this.socialGraphRepo.summarizeCandidates(userId, groupOnlyCandidateIds)
        : Promise.resolve([]),
      profileOnlyCandidateIds.length > 0
        ? this.socialGraphRepo.summarizeCandidates(userId, profileOnlyCandidateIds)
        : Promise.resolve([]),
      semanticOnlyCandidateIds.length > 0
        ? this.socialGraphRepo.summarizeCandidates(userId, semanticOnlyCandidateIds)
        : Promise.resolve([]),
      ]);

    const mergedCandidates = [
      ...graphCandidatePage.data.map((candidate) =>
        this.applySourceScores(
          candidate,
          profileCandidatesById.get(candidate.id),
          semanticCandidatesById.get(candidate.id),
          sourceMode,
        ),
      ),
      ...groupOnlyCandidates.map((candidate) =>
        this.applySourceScores(
          candidate,
          profileCandidatesById.get(candidate.id),
          semanticCandidatesById.get(candidate.id),
          sourceMode,
        ),
      ),
      ...profileOnlyCandidates.map((candidate) =>
        this.applySourceScores(
          candidate,
          profileCandidatesById.get(candidate.id),
          semanticCandidatesById.get(candidate.id),
          sourceMode,
        ),
      ),
      ...semanticOnlyCandidates.map((candidate) =>
        this.applySourceScores(
          candidate,
          profileCandidatesById.get(candidate.id),
          semanticCandidatesById.get(candidate.id),
          sourceMode,
        ),
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
      sourceMode,
      mergedCandidates,
      groupCandidates,
      commonGroupCountsByUser,
    };
  }

  async loadPrecomputedCandidateBundle(
    userId: string,
    precomputedCandidates: RecommendationPrecomputedCandidate[],
  ): Promise<RecommendationCandidateBundle> {
    const dedupedCandidates = Array.from(
      new Map(
        precomputedCandidates
          .filter((candidate) => candidate?.candidateId)
          .map((candidate) => [candidate.candidateId, candidate]),
      ).values(),
    );
    if (dedupedCandidates.length === 0) {
      return {
        graphNextCursor: null,
        candidateLimit: 0,
        sourceMode: 'precomputed',
        mergedCandidates: [],
        groupCandidates: [],
        commonGroupCountsByUser: {},
      };
    }

    const candidateIds = dedupedCandidates.map((candidate) => candidate.candidateId);
    const [summarizedCandidates, commonGroupCountsByUser] = await Promise.all([
      this.socialGraphRepo.summarizeCandidates(userId, candidateIds),
      this.groupClient.getCommonGroupCounts(userId, candidateIds),
    ]);
    const summarizedCandidatesById = new Map(
      summarizedCandidates.map((candidate) => [candidate.id, candidate]),
    );
    const semanticCandidatesById = new Map(
      dedupedCandidates.map((candidate) => [candidate.candidateId, candidate]),
    );

    return {
      graphNextCursor: null,
      candidateLimit: dedupedCandidates.length,
      sourceMode: 'precomputed',
      mergedCandidates: dedupedCandidates
        .map((candidate) => summarizedCandidatesById.get(candidate.candidateId))
        .filter(
          (
            candidate,
          ): candidate is RecommendationCandidateBundle['mergedCandidates'][number] =>
            Boolean(candidate),
        )
        .map((candidate) =>
          this.applySourceScores(
            candidate,
            undefined,
            {
              semanticMatchScore:
                semanticCandidatesById.get(candidate.id)?.semanticScore ?? 0,
            },
            'precomputed',
          ),
        ),
      groupCandidates: [],
      commonGroupCountsByUser,
    };
  }

  private applySourceScores(
    candidate: RecommendationCandidateBundle['mergedCandidates'][number],
    profileCandidate:
      | {
          profileMatchScore: number;
          matchedSignals?: string[];
          sharedInterestsCount?: number;
        }
      | undefined,
    semanticCandidate:
      | {
          semanticMatchScore: number;
        }
      | undefined,
    sourceMode: RecommendationCandidateBundle['sourceMode'],
  ) {
    if (!profileCandidate && !semanticCandidate) {
      return {
        ...candidate,
        candidateSourceMode: sourceMode,
      };
    }

    return {
      ...candidate,
      candidateSourceMode: sourceMode,
      profileMatchScore: profileCandidate?.profileMatchScore,
      profileMatchedSignals: profileCandidate?.matchedSignals ?? [],
      sharedInterestsCount: profileCandidate?.sharedInterestsCount ?? 0,
      semanticMatchScore: semanticCandidate?.semanticMatchScore,
    };
  }
}
