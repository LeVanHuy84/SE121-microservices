import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface RecommendationRerankCandidate {
  candidateId: string;
  mutualFriends: number;
  commonGroups: number;
  interactionScore?: number;
  similarityScore?: number;
  candidateProfileText?: string;
  sharedInterestCount?: number;
  baseScore: number;
  reasons: string[];
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
      return {};
    }

    try {
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

      return scores.reduce((acc: Record<string, number>, item) => {
        const candidateId = String(item?.candidateId ?? '');
        const modelScore = Number(item?.modelScore);
        if (candidateId && Number.isFinite(modelScore)) {
          acc[candidateId] = modelScore;
        }
        return acc;
      }, {});
    } catch (error) {
      this.logger.error(
        `RECOMMENDATION_SERVICE rerank failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {};
    }
  }
}
