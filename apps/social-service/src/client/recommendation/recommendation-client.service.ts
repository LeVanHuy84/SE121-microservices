import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface RecommendationRerankCandidate {
  candidateId: string;
  mutualFriends: number;
  commonGroups: number;
  candidateProfileText?: string;
}

export interface RecommendationPrecomputedCandidate {
  candidateId: string;
  semanticScore: number;
  rank: number;
  generatedAt: string;
}

export interface RecommendationPrecomputedSnapshot {
  viewerId: string;
  generatedAt: string | null;
  generationReason: string | null;
  modelName: string | null;
  candidateCount: number;
  candidates: RecommendationPrecomputedCandidate[];
}

interface RecommendationRerankScoreResponse {
  success: boolean;
  data?: {
    scores?: Array<{
      candidateId?: unknown;
      modelScore?: unknown;
    }>;
  };
}

interface RecommendationPrecomputedSnapshotResponse {
  success: boolean;
  data?: {
    viewerId?: unknown;
    generatedAt?: unknown;
    generationReason?: unknown;
    modelName?: unknown;
    candidateCount?: unknown;
    candidates?: Array<{
      candidateId?: unknown;
      semanticScore?: unknown;
      rank?: unknown;
      generatedAt?: unknown;
    }>;
  };
}

@Injectable()
export class RecommendationClientService {
  private readonly logger = new Logger(RecommendationClientService.name);

  constructor(private readonly configService: ConfigService) {}

  async getPrecomputedCandidates(
    viewerId: string,
    limit: number,
  ): Promise<RecommendationPrecomputedSnapshot | null> {
    if (!viewerId || !Number.isFinite(limit) || limit <= 0) {
      return null;
    }

    const serviceConfig = this.resolveServiceConfig();
    if (!serviceConfig) {
      return null;
    }

    try {
      const startedAt = Date.now();
      const res = await axios.get<RecommendationPrecomputedSnapshotResponse>(
        `${serviceConfig.baseUrl}/recommend/precomputed/${viewerId}`,
        {
          headers: {
            'x-internal-key': serviceConfig.internalKey,
          },
          params: {
            limit,
          },
          timeout: serviceConfig.timeoutMs,
        },
      );

      const payload = res.data?.data;
      const parsedSnapshot: RecommendationPrecomputedSnapshot = {
        viewerId: String(payload?.viewerId ?? viewerId),
        generatedAt:
          typeof payload?.generatedAt === 'string' ? payload.generatedAt : null,
        generationReason:
          typeof payload?.generationReason === 'string'
            ? payload.generationReason
            : null,
        modelName:
          typeof payload?.modelName === 'string' ? payload.modelName : null,
        candidateCount: Number.isFinite(Number(payload?.candidateCount))
          ? Number(payload?.candidateCount)
          : 0,
        candidates: Array.isArray(payload?.candidates)
          ? payload.candidates.reduce<RecommendationPrecomputedCandidate[]>(
              (acc, item) => {
                const candidateId = String(item?.candidateId ?? '').trim();
                const semanticScore = Number(item?.semanticScore);
                const rank = Number(item?.rank);
                const generatedAt =
                  typeof item?.generatedAt === 'string' ? item.generatedAt : '';

                if (
                  candidateId &&
                  Number.isFinite(semanticScore) &&
                  Number.isFinite(rank)
                ) {
                  acc.push({
                    candidateId,
                    semanticScore,
                    rank,
                    generatedAt,
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
          `RECOMMENDATION_SERVICE precomputed returned unsuccessful payload: viewerId=${viewerId} requested=${limit}`,
        );
      }

      this.logger.debug(
        `RECOMMENDATION_SERVICE precomputed resolved: viewerId=${viewerId} requested=${limit} returned=${parsedSnapshot.candidates.length} durationMs=${Date.now() - startedAt}`,
      );

      return parsedSnapshot;
    } catch (error) {
      const failureReason = this.describeFailure(error);
      this.logger.error(
        `RECOMMENDATION_SERVICE precomputed failed: viewerId=${viewerId} requested=${limit} reason=${failureReason}`,
      );
      return null;
    }
  }

  async rerankCandidates(
    viewerId: string,
    candidates: RecommendationRerankCandidate[],
    viewerProfileText?: string,
  ): Promise<Record<string, number>> {
    if (!viewerId || candidates.length === 0) {
      return {};
    }

    const serviceConfig = this.resolveServiceConfig();
    if (!serviceConfig) {
      return {};
    }

    try {
      const startedAt = Date.now();
      const res = await axios.post<RecommendationRerankScoreResponse>(
        `${serviceConfig.baseUrl}/recommend/rerank`,
        {
          viewerId,
          viewerProfileText,
          candidates,
        },
        {
          headers: {
            'x-internal-key': serviceConfig.internalKey,
          },
          timeout: serviceConfig.timeoutMs,
        },
      );

      const scores = Array.isArray(res.data?.data?.scores)
        ? res.data.data.scores
        : [];

      if (res.data?.success !== true) {
        this.logger.warn(
          `RECOMMENDATION_SERVICE rerank returned unsuccessful payload: viewerId=${viewerId} requested=${candidates.length}`,
        );
      }

      const parsedScores = scores.reduce((acc: Record<string, number>, item) => {
        const candidateId = String(item?.candidateId ?? '');
        const modelScore = Number(item?.modelScore);
        if (candidateId && Number.isFinite(modelScore)) {
          acc[candidateId] = modelScore;
        }
        return acc;
      }, {});

      this.logger.debug(
        `RECOMMENDATION_SERVICE rerank resolved: viewerId=${viewerId} requested=${candidates.length} scored=${Object.keys(parsedScores).length} durationMs=${Date.now() - startedAt}`,
      );

      return parsedScores;
    } catch (error) {
      const failureReason = this.describeFailure(error);
      this.logger.error(
        `RECOMMENDATION_SERVICE rerank failed: viewerId=${viewerId} requested=${candidates.length} reason=${failureReason}`,
      );
      return {};
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

  private resolveServiceConfig():
    | { baseUrl: string; internalKey: string; timeoutMs: number }
    | null {
    const baseUrl = this.configService.get<string>('RECOMMENDATION_SERVICE_URL');
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
      timeoutMs: this.configService.get<number>(
        'RECOMMENDATION_SERVICE_TIMEOUT_MS',
        2000,
      ),
    };
  }
}
