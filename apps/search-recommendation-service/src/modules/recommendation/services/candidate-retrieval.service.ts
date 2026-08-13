import { Injectable } from '@nestjs/common';
import { RecommendationStateRepository } from './recommendation-state.repository';

export interface RetrievalBatch {
  source: string;
  candidates: any[];
  hasNext: boolean;
  scoreVersion: string;
}

@Injectable()
export class CandidateRetrievalService {
  constructor(private readonly repository: RecommendationStateRepository) {}

  async getSemanticOnlineBatch(
    viewerId: string,
    offset: number,
    size: number,
  ): Promise<RetrievalBatch> {
    const safeOffset = Math.max(0, offset);
    const safeSize = Math.max(1, size);
    const requestLimit = safeOffset + safeSize + 1;

    const rows = await this.repository.searchSemanticCandidates(
      viewerId,
      [], // We pass empty vector as placeholder; actual embedding retrieval is handled inside repository
      requestLimit,
      Math.max(requestLimit * 3, safeSize * 3),
    );
    const pageRows = rows.slice(safeOffset, safeOffset + safeSize + 1);

    return {
      source: 'semantic_online',
      candidates: pageRows.slice(0, safeSize).map((row) => ({
        candidateId: String(row.candidateId),
        candidateProfileText: row.candidateProfileText,
        retrievalScore: Number(row.retrievalScore || 0.0),
        embedding: row.embedding,
        source: 'semantic_online',
      })),
      hasNext: pageRows.length > safeSize,
      scoreVersion: 'recommendation-query-pipeline-v1',
    };
  }

  async filterGraphProjection(
    viewerId: string,
    candidates: any[],
  ): Promise<any[]> {
    if (candidates.length === 0) return [];
    const excludedIds = await this.repository.getGraphExcludedCandidateIds(
      viewerId,
      candidates.map((c) => String(c.candidateId)),
    );

    return candidates.filter((c) => !excludedIds.has(String(c.candidateId)));
  }
}
