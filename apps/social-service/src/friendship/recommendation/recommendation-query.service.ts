import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CursorPaginationDTO,
  CursorPageResponse,
  UserResponseDTO,
} from '@repo/dtos';
import { RecommendationClientService } from '../../client/recommendation/recommendation-client.service';
import { UserClientService } from '../../client/user/user-client.service';
import {
  FriendRecommendationScoringConfig,
  loadFriendRecommendationScoringConfig,
} from '../friend-recommendation.config';
import {
  FriendRecommendation,
  SOCIAL_GRAPH_REPOSITORY,
} from '../repositories/social-graph.repository';
import type {
  SocialGraphRepository,
} from '../repositories/social-graph.repository';
import { CandidateSourceService } from './candidate-source.service';
import { RecommendationBaselineRankerService } from './recommendation-baseline-ranker.service';
import { RecommendationDiversityService } from './recommendation-diversity.service';
import { RecommendationFeatureService } from './recommendation-feature.service';
import { RecommendationHydrationService } from './recommendation-hydration.service';
import { RecommendationTrackingService } from './recommendation-tracking.service';
import type { FeatureScoredRecommendation } from './recommendation.types';

@Injectable()
export class RecommendationQueryService {
  private readonly logger = new Logger(RecommendationQueryService.name);
  private readonly overscanMultiplier = 5;
  private readonly maxOverscan = 100;
  private readonly scoringConfig: FriendRecommendationScoringConfig;

  constructor(
    @Inject(SOCIAL_GRAPH_REPOSITORY)
    private readonly socialGraphRepo: SocialGraphRepository,
    private readonly candidateSourceService: CandidateSourceService,
    private readonly baselineRanker: RecommendationBaselineRankerService,
    private readonly diversityService: RecommendationDiversityService,
    private readonly featureService: RecommendationFeatureService,
    private readonly hydrationService: RecommendationHydrationService,
    private readonly trackingService: RecommendationTrackingService,
    private readonly recommendationClient: RecommendationClientService,
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

    const candidateBundle = await this.candidateSourceService.loadCandidateBundle(
      userId,
      query,
      candidateLimit,
    );

    if (candidateBundle.mergedCandidates.length === 0) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
      };
    }

    const interactionScores = await this.featureService.getInteractionScores(
      userId,
      candidateBundle.mergedCandidates.map((candidate) => candidate.id),
    );

    const scoredCandidates = await this.applyAiModelScores(
      userId,
      candidateBundle.mergedCandidates
        .map((candidate) =>
          this.baselineRanker.buildRecommendation(
            candidate,
            candidateBundle.commonGroupCountsByUser[candidate.id] ?? 0,
            interactionScores[candidate.id] ?? 0,
          ),
        )
        .sort((left, right) =>
          this.baselineRanker.compareRecommendations(left, right),
        ),
    );
    const rankedCandidates = this.diversityService.rerank(
      scoredCandidates.sort((left, right) =>
        this.baselineRanker.compareRecommendations(left, right),
      ),
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
      this.trackingService.attachRecommendationTrackingIds(visibleData);
    const hydratedVisibleData =
      await this.hydrationService.hydrateRecommendationUsers(
        visibleRecommendations,
      );
    const responseData: FriendRecommendation[] = hydratedVisibleData.map(
      ({ featureVector: _featureVector, ...recommendation }) => recommendation,
    );
    const nextIndex = startIndex + visibleData.length;
    const hasNextPage =
      nextIndex < rankedCandidates.length ||
      candidateBundle.graphHasNextPage ||
      candidateBundle.groupCandidates.length >= candidateBundle.candidateLimit;

    await this.trackingService.recordServedEvents(
      userId,
      hydratedVisibleData,
      startIndex,
    );

    this.logger.debug(
      `Ranked ${rankedCandidates.length} friend candidates for user ${userId}`,
    );

    return {
      data: responseData,
      nextCursor:
        hasNextPage && responseData.length > 0
          ? responseData[responseData.length - 1].id
          : null,
      hasNextPage,
    };
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
    const userProfiles = await this.userClient.getUserProfiles([
      userId,
      ...rerankCandidates.map((candidate) => candidate.id),
    ]);
    const viewerProfileText = this.buildSemanticProfileText(userProfiles[userId]);
    const modelScores = await this.recommendationClient.rerankCandidates(
      userId,
      rerankCandidates.map((candidate) => ({
        candidateId: candidate.id,
        mutualFriends: candidate.mutualFriends,
        commonGroups: candidate.commonGroups ?? 0,
        interactionScore: candidate.featureVector.interactionScore,
        similarityScore: candidate.featureVector.similarityScore,
        candidateProfileText: this.buildSemanticProfileText(
          userProfiles[candidate.id],
        ),
        sharedInterestCount: candidate.featureVector.sharedInterestCount,
        baseScore: candidate.baseScore ?? candidate.score ?? 0,
        reasons: candidate.reasons ?? [],
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
    const segments = [
      fullName ? `name: ${fullName}` : '',
      bio ? `bio: ${bio}` : '',
    ].filter(Boolean);

    return segments.length > 0 ? segments.join('\n') : undefined;
  }
}
