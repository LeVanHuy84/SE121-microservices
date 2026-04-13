import { BadRequestException, Injectable } from '@nestjs/common';
import { CursorPaginationDTO, CursorPageResponse } from '@repo/dtos';
import {
  RecommendationClientService,
  RecommendationQueryCandidate,
} from '../../client/recommendation/recommendation-client.service';
import type { FriendRecommendation } from '../repositories/social-graph.repository';
import { RecommendationHydrationService } from './recommendation-hydration.service';
import { RecommendationTrackingService } from './recommendation-tracking.service';

@Injectable()
export class RecommendationQueryService {
  constructor(
    private readonly recommendationClient: RecommendationClientService,
    private readonly hydrationService: RecommendationHydrationService,
    private readonly trackingService: RecommendationTrackingService,
  ) {}

  async recommendFriends(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<FriendRecommendation>> {
    const startIndex = this.resolveCursorOffset(query.cursor);
    const limit = this.normalizeLimit(query.limit);
    const resolved = await this.recommendationClient.queryCandidates(
      userId,
      limit,
      query.cursor,
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
    const trackedRecommendations =
      this.trackingService.attachRecommendationTrackingIds(recommendations);
    const hydratedRecommendations =
      await this.hydrationService.hydrateRecommendationUsers(
        trackedRecommendations,
      );

    await this.trackingService.recordServedEvents(
      userId,
      hydratedRecommendations,
      startIndex,
    );

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
      mutualFriends: 0,
      mutualFriendIds: [],
      commonGroups: 0,
      retrievalScore: candidate.retrievalScore,
      precomputeScore:
        candidate.source === 'precomputed' ? candidate.retrievalScore : undefined,
      retrievalScoreVersion: scoreVersion,
      rerankScore: candidate.modelScore,
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
          case 'precomputed_snapshot':
            return 'From precomputed snapshot';
          case 'semantic_retrieval':
            return 'Semantic retrieval match';
          case 'semantic_rerank':
            return 'AI rerank boosted';
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
    if (source === 'precomputed') {
      return 'precomputed';
    }

    if (source === 'semantic_online') {
      return 'online';
    }

    return 'online';
  }

  private normalizeLimit(limit: number | undefined): number {
    if (typeof limit !== 'number' || !Number.isFinite(limit)) {
      return 10;
    }

    return Math.max(1, Math.floor(limit));
  }

  private resolveCursorOffset(cursor: string | null | undefined): number {
    if (!cursor) {
      return 0;
    }

    try {
      const decodedPayload = Buffer.from(cursor, 'base64url').toString('utf8');
      const parsedPayload = JSON.parse(decodedPayload) as { offset?: unknown };
      const offset = Number(parsedPayload.offset);
      if (!Number.isFinite(offset)) {
        throw new BadRequestException('Invalid recommendation cursor');
      }

      return Math.max(0, Math.floor(offset));
    } catch {
      throw new BadRequestException('Invalid recommendation cursor');
    }
  }
}
