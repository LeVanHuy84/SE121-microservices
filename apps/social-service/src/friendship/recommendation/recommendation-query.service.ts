import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BaseUserDTO,
  CursorPaginationDTO,
  CursorPageResponse,
  UserResponseDTO,
} from '@repo/dtos';
import { RecommendationClientService } from '../../client/recommendation/recommendation-client.service';
import { GroupClientService } from '../../client/group/group-client.service';
import { UserClientService } from '../../client/user/user-client.service';
import {
  FriendRecommendationScoringConfig,
  loadFriendRecommendationScoringConfig,
} from '../friend-recommendation.config';
import { FriendRecommendation } from '../repositories/social-graph.repository';
import { CandidateSourceService } from './candidate-source.service';
import { RecommendationBaselineRankerService } from './recommendation-baseline-ranker.service';
import { RecommendationDiversityService } from './recommendation-diversity.service';
import { RecommendationFeatureService } from './recommendation-feature.service';
import { RecommendationHydrationService } from './recommendation-hydration.service';
import { RecommendationSnapshotService } from './recommendation-snapshot.service';
import { RecommendationTrackingService } from './recommendation-tracking.service';
import type { FeatureScoredRecommendation } from './recommendation.types';

@Injectable()
export class RecommendationQueryService {
  private readonly logger = new Logger(RecommendationQueryService.name);
  private readonly overscanMultiplier = 5;
  private readonly maxOverscan = 100;
  private readonly scoringConfig: FriendRecommendationScoringConfig;

  constructor(
    private readonly candidateSourceService: CandidateSourceService,
    private readonly baselineRanker: RecommendationBaselineRankerService,
    private readonly diversityService: RecommendationDiversityService,
    private readonly featureService: RecommendationFeatureService,
    private readonly hydrationService: RecommendationHydrationService,
    private readonly snapshotService: RecommendationSnapshotService,
    private readonly trackingService: RecommendationTrackingService,
    private readonly recommendationClient: RecommendationClientService,
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
    const requestStartedAt = Date.now();
    let graphCursor: string | null = null;
    let includeGroupCandidates = true;

    if (query.cursor) {
      const snapshotStartedAt = Date.now();
      const snapshotPage =
        await this.snapshotService.getSnapshotPage<FeatureScoredRecommendation>(
          userId,
          query.cursor,
          requestedLimit,
        );

      if (snapshotPage) {
        this.logger.debug(
          `Recommendation snapshot hit: userId=${userId} requestedLimit=${requestedLimit} startIndex=${snapshotPage.startIndex} visible=${snapshotPage.data.length} durationMs=${Date.now() - snapshotStartedAt}`,
        );
        return this.buildRecommendationResponse(
          userId,
          snapshotPage.data,
          snapshotPage.startIndex,
          snapshotPage.nextCursor,
          snapshotPage.hasNextPage,
        );
      }

      graphCursor = this.snapshotService.getGraphContinuationCursor(query.cursor);
      includeGroupCandidates = false;

      if (!graphCursor) {
        this.logger.debug(
          `Recommendation snapshot miss: userId=${userId} requestedLimit=${requestedLimit} durationMs=${Date.now() - snapshotStartedAt}`,
        );

        throw new BadRequestException(
          'Recommendation cursor is invalid or expired',
        );
      }
    }

    const candidateLimit = Math.min(
      Math.max(requestedLimit * this.overscanMultiplier, requestedLimit),
      this.maxOverscan,
    );

    const candidateLoadStartedAt = Date.now();
    const candidateBundle = await this.candidateSourceService.loadCandidateBundle(
      userId,
      candidateLimit,
      {
        graphCursor,
        includeGroupCandidates,
      },
    );
    const candidateLoadMs = Date.now() - candidateLoadStartedAt;

    if (candidateBundle.mergedCandidates.length === 0) {
      this.logger.debug(
        `Recommendation query returned no candidates: userId=${userId} requestedLimit=${requestedLimit} candidateLimit=${candidateLimit} totalMs=${Date.now() - requestStartedAt}`,
      );
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
      };
    }

    const scoringStartedAt = Date.now();
    const scoredCandidates = await this.applyAiModelScores(
      userId,
      candidateBundle.mergedCandidates
        .map((candidate) =>
          this.baselineRanker.buildRecommendation(
            candidate,
            candidateBundle.commonGroupCountsByUser[candidate.id] ?? 0,
          ),
        )
        .sort((left, right) =>
          this.baselineRanker.compareRecommendations(left, right),
        ),
    );
    const scoringMs = Date.now() - scoringStartedAt;
    const rankedCandidates = this.diversityService.rerank(
      scoredCandidates.sort((left, right) =>
        this.baselineRanker.compareRecommendations(left, right),
      ),
    );

    const snapshotWriteStartedAt = Date.now();
    const snapshotPage =
      await this.snapshotService.createSnapshotPage<FeatureScoredRecommendation>(
      userId,
      rankedCandidates,
      requestedLimit,
      candidateBundle.graphNextCursor,
    );
    const snapshotWriteMs = Date.now() - snapshotWriteStartedAt;

    this.logger.debug(
      `Recommendation query resolved with snapshot write: userId=${userId} requestedLimit=${requestedLimit} candidateLimit=${candidateLimit} mergedCandidates=${candidateBundle.mergedCandidates.length} ranked=${rankedCandidates.length} graphNextCursor=${candidateBundle.graphNextCursor ?? 'null'} groupCandidates=${candidateBundle.groupCandidates.length} candidateLoadMs=${candidateLoadMs} scoringMs=${scoringMs} snapshotWriteMs=${snapshotWriteMs} totalMs=${Date.now() - requestStartedAt}`,
    );

    return this.buildRecommendationResponse(
      userId,
      snapshotPage.data,
      snapshotPage.startIndex,
      snapshotPage.nextCursor,
      snapshotPage.hasNextPage,
    );
  }

  private async applyAiModelScores(
    userId: string,
    recommendations: FeatureScoredRecommendation[],
  ): Promise<FeatureScoredRecommendation[]> {
    if (recommendations.length === 0 || this.scoringConfig.aiTopK <= 0) {
      return recommendations;
    }

    const rerankCandidates = recommendations.slice(
      0,
      this.scoringConfig.aiTopK,
    );
    const mutualFriendIds = [
      ...new Set(
        rerankCandidates.flatMap((candidate) =>
          candidate.mutualFriendIds.slice(0, 3),
        ),
      ),
    ];
    const [userProfiles, mutualFriendProfiles, commonGroupNames] = await Promise.all([
      this.userClient.getUsers(
        [
          userId,
          ...rerankCandidates.map((candidate) => candidate.id),
        ],
        'full',
      ),
      this.userClient.getUsers(mutualFriendIds, 'base'),
      this.groupClient.getCommonGroupNames(
        userId,
        rerankCandidates.map((candidate) => candidate.id),
        3,
      ),
    ]);
    const viewerProfileText = this.buildSemanticProfileText(userProfiles[userId]);
    const modelScores = await this.recommendationClient.rerankCandidates(
      userId,
      rerankCandidates.map((candidate) => ({
        candidateId: candidate.id,
        mutualFriends: candidate.mutualFriends,
        commonGroups: candidate.commonGroups ?? 0,
        candidateProfileText: this.buildCandidateSemanticProfileText(
          userProfiles[candidate.id],
          candidate,
          mutualFriendProfiles,
          commonGroupNames[candidate.id] ?? [],
        ),
      })),
      viewerProfileText,
    );

    if (Object.keys(modelScores).length === 0) {
      return recommendations;
    }

    return recommendations.map((candidate) => {
      const modelScore = modelScores[candidate.id];
      if (!Number.isFinite(modelScore)) {
        return candidate;
      }

      return {
        ...candidate,
        modelScore,
        score:
          (candidate.baseScore ?? candidate.score ?? 0) +
          modelScore * this.scoringConfig.aiWeight,
      };
    });
  }

  private normalizeLimit(limit: number | undefined): number {
    if (typeof limit !== 'number' || !Number.isFinite(limit)) {
      return 10;
    }

    return Math.max(1, Math.floor(limit));
  }

  private async buildRecommendationResponse(
    userId: string,
    visibleData: FeatureScoredRecommendation[],
    startIndex: number,
    nextCursor: string | null,
    hasNextPage: boolean,
  ): Promise<CursorPageResponse<FriendRecommendation>> {
    const responseStartedAt = Date.now();
    const visibleRecommendations =
      this.trackingService.attachRecommendationTrackingIds(visibleData);
    const hydratedVisibleData =
      await this.hydrationService.hydrateRecommendationUsers(
        visibleRecommendations,
      );
    const responseData: FriendRecommendation[] = hydratedVisibleData.map(
      ({ featureVector: _featureVector, ...recommendation }) => recommendation,
    );

    await this.trackingService.recordServedEvents(
      userId,
      hydratedVisibleData,
      startIndex,
    );

    this.logger.debug(
      `Recommendation response built: userId=${userId} visible=${responseData.length} startIndex=${startIndex} hasNextPage=${hasNextPage} durationMs=${Date.now() - responseStartedAt}`,
    );

    return {
      data: responseData,
      nextCursor,
      hasNextPage,
    };
  }

  private buildSemanticProfileText(
    profile: UserResponseDTO | undefined,
  ): string | undefined {
    if (!profile) {
      return undefined;
    }

    const fullName = [profile.firstName, profile.lastName]
      .filter((value) => typeof value === 'string' && value.trim().length > 0)
      .join(' ')
      .trim();
    const bio =
      typeof profile.bio === 'string' && profile.bio.trim().length > 0
        ? profile.bio.trim()
        : '';
    const location =
      typeof profile.location === 'string' && profile.location.trim().length > 0
        ? profile.location.trim()
        : '';
    const school =
      typeof profile.school === 'string' && profile.school.trim().length > 0
        ? profile.school.trim()
        : '';
    const jobTitle =
      typeof profile.jobTitle === 'string' && profile.jobTitle.trim().length > 0
        ? profile.jobTitle.trim()
        : '';
    const company =
      typeof profile.company === 'string' && profile.company.trim().length > 0
        ? profile.company.trim()
        : '';
    const interests = Array.isArray(profile.interests)
      ? profile.interests
          .map((interest) =>
            typeof interest === 'string' ? interest.trim() : '',
          )
          .filter(Boolean)
      : [];
    const work = [jobTitle, company].filter(Boolean).join(' at ');
    const segments = [
      fullName ? `name: ${fullName}` : '',
      bio ? `bio: ${bio}` : '',
      location ? `location: ${location}` : '',
      work ? `work: ${work}` : '',
      school ? `school: ${school}` : '',
      interests.length > 0 ? `interests: ${interests.join(', ')}` : '',
    ].filter(Boolean);

    return segments.length > 0 ? segments.join('\n') : undefined;
  }

  private buildCandidateSemanticProfileText(
    profile: UserResponseDTO | undefined,
    candidate: FeatureScoredRecommendation,
    mutualFriendProfiles: Record<string, BaseUserDTO>,
    commonGroupNames: string[],
  ): string | undefined {
    const baseProfileText = this.buildSemanticProfileText(profile);
    const mutualFriendNames = candidate.mutualFriendIds
      .slice(0, 3)
      .map((mutualFriendId) => {
        const user = mutualFriendProfiles[mutualFriendId];
        if (!user) {
          return '';
        }

        return [user.firstName, user.lastName]
          .filter((value) => typeof value === 'string' && value.trim().length > 0)
          .join(' ')
          .trim();
      })
      .filter(Boolean);
    const segments = [
      baseProfileText ?? '',
      candidate.mutualFriends > 0
        ? `social context: ${candidate.mutualFriends} mutual friends`
        : '',
      mutualFriendNames.length > 0
        ? `connected with: ${mutualFriendNames.join(', ')}`
        : '',
      (candidate.commonGroups ?? 0) > 0
        ? `group context: ${candidate.commonGroups} common groups`
        : '',
      commonGroupNames.length > 0
        ? `common groups: ${commonGroupNames.join(', ')}`
        : '',
    ].filter(Boolean);

    return segments.length > 0 ? segments.join('\n') : undefined;
  }
}
