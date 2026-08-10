import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

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

interface RecommendationQueryResponse {
  success: boolean;
  data?: {
    viewerId?: unknown;
    generatedAt?: unknown;
    source?: unknown;
    scoreVersion?: unknown;
    candidateCount?: unknown;
    nextCursor?: unknown;
    hasNextPage?: unknown;
    candidates?: Array<{
      candidateId?: unknown;
      source?: unknown;
      retrievalScore?: unknown;
      modelScore?: unknown;
      finalScore?: unknown;
      mutualFriendCount?: unknown;
      commonGroupCount?: unknown;
      scoreVersion?: unknown;
      reasonCodes?: unknown;
      rank?: unknown;
    }>;
  };
}

@Injectable()
export class RecommendationClientService {
  private readonly logger = new Logger(RecommendationClientService.name);

  constructor(private readonly configService: ConfigService) {}

  async queryCandidates(
    viewerId: string,
    limit: number,
    cursor?: string | null,
  ): Promise<RecommendationQueryResult | null> {
    if (!viewerId || !Number.isFinite(limit) || limit <= 0) {
      return null;
    }

    const serviceConfig = this.resolveServiceConfig();
    if (!serviceConfig) {
      return null;
    }

    try {
      const startedAt = Date.now();
      const res = await axios.post<RecommendationQueryResponse>(
        `${serviceConfig.baseUrl}/recommend/query`,
        {
          viewerId,
          limit,
          cursor: cursor ?? undefined,
        },
        {
          headers: {
            'x-internal-key': serviceConfig.internalKey,
          },
          timeout: serviceConfig.timeoutMs,
        },
      );

      const payload = res.data?.data;
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
          ? payload.candidates.reduce<RecommendationQueryCandidate[]>(
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

      if (res.data?.success !== true) {
        this.logger.warn(
          `RECOMMENDATION_SERVICE query returned unsuccessful payload: viewerId=${viewerId} requested=${limit}`,
        );
      }

      this.logger.debug(
        `RECOMMENDATION_SERVICE query resolved: viewerId=${viewerId} requested=${limit} returned=${parsed.candidates.length} durationMs=${Date.now() - startedAt}`,
      );

      return parsed;
    } catch (error) {
      const failureReason = this.describeFailure(error);
      this.logger.error(
        `RECOMMENDATION_SERVICE query failed: viewerId=${viewerId} requested=${limit} baseUrl=${serviceConfig.baseUrl} reason=${failureReason}`,
      );
      return null;
    }
  }

  private describeFailure(error: unknown): string {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        return `http_${error.response.status}`;
      }

      if (error.code === 'ECONNABORTED') {
        return 'timeout';
      }

      if (error.code) {
        return error.code;
      }

      return error.message;
    }

    return error instanceof Error ? error.message : String(error);
  }

  private resolveServiceConfig(): {
    baseUrl: string;
    internalKey: string;
    timeoutMs: number;
  } | null {
    const baseUrl = this.configService.get<string>(
      'RECOMMENDATION_SERVICE_URL',
    );
    const internalKey = this.configService.get<string>(
      'RECOMMENDATION_INTERNAL_KEY',
    );

    if (!baseUrl || !internalKey) {
      const missingConfig = [
        !baseUrl ? 'RECOMMENDATION_SERVICE_URL' : null,
        !internalKey ? 'RECOMMENDATION_INTERNAL_KEY' : null,
      ].filter(Boolean);
      this.logger.warn(
        `RECOMMENDATION_SERVICE skipped: missing config ${missingConfig.join(', ')}`,
      );
      return null;
    }

    return {
      baseUrl,
      internalKey,
      timeoutMs: Number(
        this.configService.get<string | number>(
          'RECOMMENDATION_SERVICE_TIMEOUT_MS',
          30000,
        )
      ) || 30000,
    };
  }
}
