import { Inject, Injectable } from '@nestjs/common';
import {
  GroupClientService,
  type GroupRecommendationCandidate,
} from '../../client/group/group-client.service';
import { RecommendationPrecomputedCandidate } from '../../client/recommendation/recommendation-client.service';
import { UserClientService } from '../../client/user/user-client.service';
import { SOCIAL_GRAPH_REPOSITORY } from '../repositories/social-graph.repository';
import type {
  FriendRecommendation,
  SocialGraphRepository,
} from '../repositories/social-graph.repository';
import {
  RecommendationCandidateBundle,
  type RecommendationCandidateSourceMode,
} from './recommendation.types';

type CandidateBundleItem =
  RecommendationCandidateBundle['mergedCandidates'][number];
type OnlineSourceOptions = {
  includeGroupCandidates: boolean;
  includeProfileCandidates: boolean;
  includeSemanticCandidates: boolean;
};
type LoadCandidateBundleOptions = {
  graphCursor?: string | null;
  includeGroupCandidates?: boolean;
  includeProfileCandidates?: boolean;
  includeSemanticCandidates?: boolean;
};
type ProfileRecommendationCandidate = Awaited<
  ReturnType<UserClientService['getProfileRecommendationCandidates']>
>[number];
type SemanticRecommendationCandidate = Awaited<
  ReturnType<UserClientService['getSemanticRecommendationCandidates']>
>[number];
type OnlineCandidateSources = {
  graphCandidatePage: Awaited<
    ReturnType<SocialGraphRepository['recommendFriends']>
  >;
  groupCandidates: GroupRecommendationCandidate[];
  profileCandidates: ProfileRecommendationCandidate[];
  semanticCandidates: SemanticRecommendationCandidate[];
};
type CandidateSourceScoreMaps = {
  profileCandidatesById: Map<string, ProfileRecommendationCandidate>;
  semanticCandidatesById: Map<string, SemanticRecommendationCandidate>;
};

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
    options?: LoadCandidateBundleOptions,
  ): Promise<RecommendationCandidateBundle> {
    const graphCursor = options?.graphCursor ?? undefined;
    const sourceMode = this.resolveOnlineSourceMode(graphCursor);
    const sourceOptions = this.resolveOnlineSourceOptions(graphCursor, options);
    const sources = await this.loadOnlineCandidateSources(
      userId,
      candidateLimit,
      graphCursor,
      sourceOptions,
    );
    const scoreMaps = this.buildCandidateScoreMaps(sources);
    const sourceOnlyCandidates = await this.loadSourceOnlyCandidateSummaries(
      userId,
      sources,
    );
    const mergedCandidates = this.mergeOnlineCandidates(
      sources.graphCandidatePage.data,
      sourceOnlyCandidates,
      scoreMaps,
      sourceMode,
    );
    const commonGroupCountsByUser = await this.resolveCommonGroupCountsByUser(
      userId,
      mergedCandidates,
      sources.groupCandidates,
    );

    return {
      graphNextCursor: sources.graphCandidatePage.hasNextPage
        ? sources.graphCandidatePage.nextCursor
        : null,
      candidateLimit,
      sourceMode,
      mergedCandidates,
      groupCandidates: sources.groupCandidates,
      commonGroupCountsByUser,
    };
  }

  async loadPrecomputedCandidateBundle(
    userId: string,
    precomputedCandidates: RecommendationPrecomputedCandidate[],
  ): Promise<RecommendationCandidateBundle> {
    const dedupedCandidates = this.dedupePrecomputedCandidates(
      precomputedCandidates,
    );
    if (dedupedCandidates.length === 0) {
      return this.createEmptyCandidateBundle('precomputed');
    }

    const candidateIds = dedupedCandidates.map(
      (candidate) => candidate.candidateId,
    );
    const [summarizedCandidates, commonGroupCountsByUser] = await Promise.all([
      this.socialGraphRepo.summarizeCandidates(userId, candidateIds),
      this.groupClient.getCommonGroupCounts(userId, candidateIds),
    ]);
    const summarizedCandidatesById = this.toCandidateMap(summarizedCandidates);
    const semanticScoresById = new Map(
      dedupedCandidates.map((candidate) => [
        candidate.candidateId,
        candidate.semanticScore,
      ]),
    );

    return {
      graphNextCursor: null,
      candidateLimit: dedupedCandidates.length,
      sourceMode: 'precomputed',
      mergedCandidates: dedupedCandidates
        .map((candidate) => summarizedCandidatesById.get(candidate.candidateId))
        .filter((candidate): candidate is CandidateBundleItem =>
          Boolean(candidate),
        )
        .map((candidate) =>
          this.applySourceScores(
            candidate,
            undefined,
            {
              semanticMatchScore: semanticScoresById.get(candidate.id) ?? 0,
            },
            'precomputed',
          ),
        ),
      groupCandidates: [],
      commonGroupCountsByUser,
    };
  }

  private resolveOnlineSourceMode(
    graphCursor: string | undefined,
  ): RecommendationCandidateSourceMode {
    return graphCursor ? 'graph_continuation' : 'online';
  }

  private resolveOnlineSourceOptions(
    graphCursor: string | undefined,
    options?: LoadCandidateBundleOptions,
  ): OnlineSourceOptions {
    const includeSecondarySourcesByDefault = !graphCursor;

    return {
      includeGroupCandidates:
        options?.includeGroupCandidates ?? includeSecondarySourcesByDefault,
      includeProfileCandidates:
        options?.includeProfileCandidates ?? includeSecondarySourcesByDefault,
      includeSemanticCandidates:
        options?.includeSemanticCandidates ?? includeSecondarySourcesByDefault,
    };
  }

  private async loadOnlineCandidateSources(
    userId: string,
    candidateLimit: number,
    graphCursor: string | undefined,
    options: OnlineSourceOptions,
  ): Promise<OnlineCandidateSources> {
    const [
      graphCandidatePage,
      groupCandidates,
      profileCandidates,
      semanticCandidates,
    ] = await Promise.all([
      this.socialGraphRepo.recommendFriends(userId, {
        cursor: graphCursor,
        limit: candidateLimit,
      }),
      options.includeGroupCandidates
        ? this.groupClient.getGroupRecommendationCandidates(
            userId,
            candidateLimit,
          )
        : Promise.resolve([]),
      options.includeProfileCandidates
        ? this.userClient.getProfileRecommendationCandidates(
            userId,
            candidateLimit,
          )
        : Promise.resolve([]),
      options.includeSemanticCandidates
        ? this.userClient.getSemanticRecommendationCandidates(
            userId,
            candidateLimit,
          )
        : Promise.resolve([]),
    ]);

    return {
      graphCandidatePage,
      groupCandidates,
      profileCandidates,
      semanticCandidates,
    };
  }

  private buildCandidateScoreMaps(
    sources: OnlineCandidateSources,
  ): CandidateSourceScoreMaps {
    return {
      profileCandidatesById: this.toCandidateMap(sources.profileCandidates),
      semanticCandidatesById: this.toCandidateMap(sources.semanticCandidates),
    };
  }

  private async loadSourceOnlyCandidateSummaries(
    userId: string,
    sources: OnlineCandidateSources,
  ): Promise<CandidateBundleItem[]> {
    const seenCandidateIds = new Set(
      sources.graphCandidatePage.data.map((candidate) => candidate.id),
    );
    const sourceOnlyCandidateIds = [
      ...this.collectNewCandidateIds(sources.groupCandidates, seenCandidateIds),
      ...this.collectNewCandidateIds(
        sources.profileCandidates,
        seenCandidateIds,
      ),
      ...this.collectNewCandidateIds(
        sources.semanticCandidates,
        seenCandidateIds,
      ),
    ];

    return this.summarizeCandidateIds(userId, sourceOnlyCandidateIds);
  }

  private collectNewCandidateIds(
    candidates: Array<{ id: string }>,
    seenCandidateIds: Set<string>,
  ): string[] {
    const candidateIds: string[] = [];

    for (const candidate of candidates) {
      if (!candidate.id || seenCandidateIds.has(candidate.id)) {
        continue;
      }

      seenCandidateIds.add(candidate.id);
      candidateIds.push(candidate.id);
    }

    return candidateIds;
  }

  private summarizeCandidateIds(userId: string, candidateIds: string[]) {
    if (candidateIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.socialGraphRepo.summarizeCandidates(userId, candidateIds);
  }

  private mergeOnlineCandidates(
    graphCandidates: FriendRecommendation[],
    sourceOnlyCandidates: CandidateBundleItem[],
    scoreMaps: CandidateSourceScoreMaps,
    sourceMode: RecommendationCandidateSourceMode,
  ): CandidateBundleItem[] {
    return [...graphCandidates, ...sourceOnlyCandidates].map((candidate) =>
      this.applySourceScores(
        candidate,
        scoreMaps.profileCandidatesById.get(candidate.id),
        scoreMaps.semanticCandidatesById.get(candidate.id),
        sourceMode,
      ),
    );
  }

  private async resolveCommonGroupCountsByUser(
    userId: string,
    mergedCandidates: CandidateBundleItem[],
    groupCandidates: GroupRecommendationCandidate[],
  ) {
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

    return commonGroupCountsByUser;
  }

  private dedupePrecomputedCandidates(
    candidates: RecommendationPrecomputedCandidate[],
  ): RecommendationPrecomputedCandidate[] {
    return Array.from(
      new Map(
        candidates
          .filter((candidate) => candidate?.candidateId)
          .map((candidate) => [candidate.candidateId, candidate]),
      ).values(),
    );
  }

  private createEmptyCandidateBundle(
    sourceMode: RecommendationCandidateSourceMode,
  ): RecommendationCandidateBundle {
    return {
      graphNextCursor: null,
      candidateLimit: 0,
      sourceMode,
      mergedCandidates: [],
      groupCandidates: [],
      commonGroupCountsByUser: {},
    };
  }

  private toCandidateMap<T extends { id: string }>(candidates: T[]) {
    return new Map(candidates.map((candidate) => [candidate.id, candidate]));
  }

  private applySourceScores(
    candidate: CandidateBundleItem,
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
    sourceMode: RecommendationCandidateSourceMode,
  ): CandidateBundleItem {
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
