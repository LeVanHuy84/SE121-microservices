import { Inject, Injectable, Logger } from '@nestjs/common';
import { CursorPaginationDTO, CursorPageResponse } from '@repo/dtos';
import { GroupClientService } from '../../client/group/group-client.service';
import {
  RecommendationClientService,
  RecommendationQueryCandidate,
} from '../../client/recommendation/recommendation-client.service';
import {
  SOCIAL_GRAPH_REPOSITORY,
  type FriendRecommendation,
  type SocialGraphRepository,
} from '../repositories/social-graph.repository';
import { RecommendationHydrationService } from './recommendation-hydration.service';
import { RecommendationTrackingService } from './recommendation-tracking.service';

@Injectable()
export class RecommendationQueryService {
  private readonly logger = new Logger(RecommendationQueryService.name);
  private readonly defaultLimit = 10;
  private readonly maxLimit = 20;

  constructor(
    private readonly recommendationClient: RecommendationClientService,
    private readonly hydrationService: RecommendationHydrationService,
    private readonly trackingService: RecommendationTrackingService,
    @Inject(SOCIAL_GRAPH_REPOSITORY)
    private readonly socialGraphRepo: SocialGraphRepository,
    private readonly groupClient: GroupClientService,
  ) {}

  async recommendFriends(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<FriendRecommendation>> {
    const normalizedCursor = this.normalizeCursor(query.cursor);
    const startIndex = this.resolveCursorOffset(normalizedCursor);
    const limit = this.normalizeLimit(query.limit);
    this.logger.debug(
      `Recommendation query request: userId=${userId} limit=${limit} cursor=${normalizedCursor ?? 'none'} startIndex=${startIndex}`,
    );
    const resolved = await this.recommendationClient.queryCandidates(
      userId,
      limit,
      normalizedCursor,
    );

    if (!resolved || resolved.candidates.length === 0) {
      return {
        data: [],
        nextCursor: resolved?.nextCursor ?? null,
        hasNextPage: resolved?.hasNextPage ?? false,
      };
    }

    const recommendations = resolved.candidates.map((candidate) =>
      this.toFriendRecommendation(candidate, resolved.scoreVersion),
    );
    const enrichedRecommendations = await this.enrichGraphContext(
      userId,
      recommendations,
    );
    const trackedRecommendations =
      this.trackingService.attachRecommendationTrackingIds(
        enrichedRecommendations,
      );
    const hydratedRecommendations =
      await this.hydrationService.hydrateRecommendationUsers(
        trackedRecommendations,
      );

    void this.trackingService
      .recordServedEvents(userId, trackedRecommendations, startIndex)
      .catch((error) => {
        this.logger.warn(`recordServedEvents failed: ${error.message}`);
      });

    return {
      data: hydratedRecommendations,
      nextCursor: resolved.nextCursor,
      hasNextPage: resolved.hasNextPage,
    };
  }

  private toFriendRecommendation(
    candidate: RecommendationQueryCandidate,
    scoreVersion: string,
  ): FriendRecommendation {
    return {
      id: candidate.candidateId,
      mutualFriends: this.normalizeCount(candidate.mutualFriendCount),
      mutualFriendIds: [],
      commonGroups: this.normalizeCount(candidate.commonGroupCount),
      retrievalScore: candidate.retrievalScore,
      retrievalScoreVersion: scoreVersion,
      modelScore: candidate.modelScore,
      score: candidate.finalScore,
      reasons: this.toHumanReasons(candidate.reasonCodes),
      candidateSourceMode: this.mapCandidateSourceMode(candidate.source),
    };
  }

  private toHumanReasons(reasonCodes: string[]): string[] {
    const reasons = reasonCodes
      .map((reasonCode) => {
        switch (reasonCode) {
          case 'semantic_retrieval':
            return 'Semantic retrieval match';
          case 'semantic_rerank':
            return 'AI rerank boosted';
          case 'graph_mutual_friend':
            return 'Mutual friends';
          case 'graph_common_group':
            return 'Common groups';
          case 'graph_rerank':
            return 'Social graph boosted';
          case 'graph_recent_unblock':
          case 'graph_recent_request_canceled':
          case 'graph_recent_friendship_removed':
            return 'Recent graph update';
          case 'global_fallback':
            return 'Global fallback recommendation';
          default:
            return '';
        }
      })
      .filter(Boolean);

    return reasons.length > 0 ? reasons : ['Suggested for you'];
  }

  private mapCandidateSourceMode(
    source: string,
  ): FriendRecommendation['candidateSourceMode'] {
    if (source === 'semantic_online') {
      return 'online';
    }

    if (source === 'hybrid') {
      return 'hybrid';
    }

    if (source === 'global_fallback') {
      return 'fallback';
    }

    return 'fallback';
  }

  private async enrichGraphContext(
    userId: string,
    recommendations: FriendRecommendation[],
  ): Promise<FriendRecommendation[]> {
    if (recommendations.length === 0) {
      return recommendations;
    }

    const candidateIds = [
      ...new Set(recommendations.map((recommendation) => recommendation.id)),
    ];
    const [candidateSummaries, commonGroupCounts] = await Promise.all([
      this.socialGraphRepo.summarizeCandidates(userId, candidateIds),
      this.groupClient.getCommonGroupCounts(userId, candidateIds),
    ]);
    const summariesById = new Map(
      candidateSummaries.map((summary) => [summary.id, summary]),
    );

    return recommendations.map((recommendation) => {
      const summary = summariesById.get(recommendation.id);
      const commonGroups = Number(commonGroupCounts[recommendation.id]);
      const resolvedMutualFriends = Math.max(
        this.normalizeCount(recommendation.mutualFriends),
        summary?.mutualFriends ?? 0,
      );
      const resolvedCommonGroups = Math.max(
        this.normalizeCount(recommendation.commonGroups),
        this.normalizeCount(commonGroups),
      );
      const reasons = [...(recommendation.reasons ?? [])];
      if (resolvedMutualFriends > 0 && !reasons.includes('Mutual friends')) {
        reasons.push('Mutual friends');
      }
      if (resolvedCommonGroups > 0 && !reasons.includes('Common groups')) {
        reasons.push('Common groups');
      }

      return {
        ...recommendation,
        mutualFriends: resolvedMutualFriends,
        mutualFriendIds:
          summary?.mutualFriendIds ?? recommendation.mutualFriendIds,
        commonGroups: resolvedCommonGroups,
        reasons,
      };
    });
  }

  private normalizeCount(value: unknown): number {
    const resolvedValue = Number(value);
    return Number.isFinite(resolvedValue)
      ? Math.max(0, Math.floor(resolvedValue))
      : 0;
  }

  private normalizeLimit(limit: number | undefined): number {
    if (typeof limit !== 'number' || !Number.isFinite(limit)) {
      return this.defaultLimit;
    }

    return Math.min(this.maxLimit, Math.max(1, Math.floor(limit)));
  }

  private normalizeCursor(cursor: string | null | undefined): string | undefined {
    if (typeof cursor !== 'string') {
      return undefined;
    }

    const normalized = cursor.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private resolveCursorOffset(cursor: string | undefined): number {
    if (!cursor) {
      return 0;
    }

    const parsedFromBase64Url = this.tryResolveOffsetFromCursor(cursor, 'base64url');
    if (parsedFromBase64Url !== null) {
      return parsedFromBase64Url;
    }

    const parsedFromBase64 = this.tryResolveOffsetFromCursor(cursor, 'base64');
    if (parsedFromBase64 !== null) {
      return parsedFromBase64;
    }

    this.logger.warn(`Ignoring invalid recommendation cursor for tracking: ${cursor}`);
    return 0;
  }

  private tryResolveOffsetFromCursor(
    cursor: string,
    encoding: BufferEncoding,
  ): number | null {
    try {
      const decodedPayload = Buffer.from(cursor, encoding).toString('utf8');
      const parsedPayload = JSON.parse(decodedPayload) as { offset?: unknown };
      const offset = Number(parsedPayload.offset);
      if (!Number.isFinite(offset)) {
        return null;
      }

      return Math.max(0, Math.floor(offset));
    } catch {
      return null;
    }
  }
}
