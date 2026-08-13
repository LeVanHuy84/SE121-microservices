import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy, ClientProxyFactory, Transport } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

export interface RecommendationQueryCandidate {
  candidateId: string;
  source: string;
  retrievalScore: number;
  modelScore: number;
  finalScore: number;
  mutualFriendCount: number;
  commonGroupCount: number;
  scoreVersion: string;
  reasonCodes: string[];
  rank: number;
}

export interface RecommendationQueryResult {
  viewerId: string;
  generatedAt: string;
  source: string;
  scoreVersion: string;
  candidateCount: number;
  nextCursor: string | null;
  hasNextPage: boolean;
  candidates: RecommendationQueryCandidate[];
}

@Injectable()
export class RecommendationClientService {
  private readonly logger = new Logger(RecommendationClientService.name);
  private readonly client: ClientProxy;

  constructor(private readonly configService: ConfigService) {
    const port = Number(this.configService.get<string | number>('SEARCH_RECOMMENDATION_SERVICE_PORT', 4009)) || 4009;
    this.client = ClientProxyFactory.create({
      transport: Transport.TCP,
      options: {
        host: 'localhost',
        port,
      },
    });
  }

  async queryCandidates(
    viewerId: string,
    limit: number,
    cursor?: string | null,
  ): Promise<RecommendationQueryResult | null> {
    if (!viewerId || !Number.isFinite(limit) || limit <= 0) {
      return null;
    }

    try {
      const startedAt = Date.now();
      const response = await firstValueFrom(
        this.client.send<any>('query_recommendation_candidates', {
          viewerId,
          limit,
          cursor: cursor ?? undefined,
        })
      );

      if (!response || response.success !== true) {
        this.logger.warn(
          `RECOMMENDATION_SERVICE query returned unsuccessful payload or empty response: viewerId=${viewerId} requested=${limit}`,
        );
        return null;
      }

      const payload = response.data;
      const parsed: RecommendationQueryResult = {
        viewerId: String(payload?.viewerId ?? viewerId),
        generatedAt:
          typeof payload?.generatedAt === 'string'
            ? payload.generatedAt
            : new Date().toISOString(),
        source:
          typeof payload?.source === 'string' ? payload.source : 'unknown',
        scoreVersion:
          typeof payload?.scoreVersion === 'string'
            ? payload.scoreVersion
            : 'recommendation-query-pipeline-v1',
        candidateCount: Number.isFinite(Number(payload?.candidateCount))
          ? Number(payload?.candidateCount)
          : 0,
        nextCursor:
          typeof payload?.nextCursor === 'string' ? payload.nextCursor : null,
        hasNextPage: payload?.hasNextPage === true,
        candidates: Array.isArray(payload?.candidates)
          ? (payload.candidates as any[]).reduce<RecommendationQueryCandidate[]>(
              (acc, item) => {
                const candidateId = String(item?.candidateId ?? '').trim();
                const source = String(item?.source ?? '').trim();
                const retrievalScore = Number(item?.retrievalScore);
                const modelScore = Number(item?.modelScore);
                const finalScore = Number(item?.finalScore);
                const mutualFriendCount = Number(item?.mutualFriendCount);
                const commonGroupCount = Number(item?.commonGroupCount);
                const rank = Number(item?.rank);

                if (
                  candidateId &&
                  source &&
                  Number.isFinite(retrievalScore) &&
                  Number.isFinite(modelScore) &&
                  Number.isFinite(finalScore) &&
                  Number.isFinite(rank)
                ) {
                  acc.push({
                    candidateId,
                    source,
                    retrievalScore,
                    modelScore,
                    finalScore,
                    mutualFriendCount: Number.isFinite(mutualFriendCount)
                      ? Math.max(0, Math.floor(mutualFriendCount))
                      : 0,
                    commonGroupCount: Number.isFinite(commonGroupCount)
                      ? Math.max(0, Math.floor(commonGroupCount))
                      : 0,
                    scoreVersion:
                      typeof item?.scoreVersion === 'string'
                        ? item.scoreVersion
                        : 'recommendation-query-pipeline-v1',
                    reasonCodes: Array.isArray(item?.reasonCodes)
                      ? item.reasonCodes
                          .filter(
                            (reasonCode): reasonCode is string =>
                              typeof reasonCode === 'string' &&
                              reasonCode.trim().length > 0,
                          )
                          .map((reasonCode) => reasonCode.trim())
                      : [],
                    rank,
                  });
                }

                return acc;
              },
              [],
            )
          : [],
      };

      this.logger.debug(
        `RECOMMENDATION_SERVICE query resolved: viewerId=${viewerId} requested=${limit} returned=${parsed.candidates.length} durationMs=${Date.now() - startedAt}`,
      );

      return parsed;
    } catch (error: any) {
      this.logger.error(
        `RECOMMENDATION_SERVICE query failed: viewerId=${viewerId} requested=${limit} reason=${error.message}`,
      );
      return null;
    }
  }
}
