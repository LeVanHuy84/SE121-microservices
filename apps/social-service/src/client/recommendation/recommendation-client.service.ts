import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface RecommendationRerankCandidate {
  candidateId: string;
  mutualFriends: number;
  commonGroups: number;
  candidateProfileText?: string;
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

@Injectable()
export class RecommendationClientService {
  private readonly logger = new Logger(RecommendationClientService.name);

  constructor(private readonly configService: ConfigService) {}

  async rerankCandidates(
    viewerId: string,
    candidates: RecommendationRerankCandidate[],
    viewerProfileText?: string,
  ): Promise<Record<string, number>> {
    if (!viewerId || candidates.length === 0) {
      return {};
    }

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
        `RECOMMENDATION_SERVICE rerank skipped: missing config ${missingConfig.join(', ')}`,
      );
      return {};
    }

    try {
      const startedAt = Date.now();
      const res = await axios.post<RecommendationRerankScoreResponse>(
        `${baseUrl}/recommend/rerank`,
        {
          viewerId,
          viewerProfileText,
          candidates,
        },
        {
          headers: {
            'x-internal-key': internalKey,
          },
          timeout: this.configService.get<number>(
            'RECOMMENDATION_SERVICE_TIMEOUT_MS',
            2000,
          ),
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
}
